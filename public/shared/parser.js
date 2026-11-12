/* ============================================================
   ইজি লেনদেন — WhatsApp মেসেজ থেকে নম্বর ও টাকা বের করা
   ------------------------------------------------------------
   Entry (সালাম ভাইয়ের লেনদেন) আর Raf (রাফ হিসাব) দুই পেজই এটা ব্যবহার করে।
   /shared/app.js এর পরে লোড করতে হবে।
   ============================================================ */

/* ============================================================
   PARSE + CHECKS   (no DOM in this section)
   ------------------------------------------------------------
   নিয়ম: ১১-ডিজিট নম্বর → তার পরের প্রথম সংখ্যা = টাকা
   তার সাথে নিরাপত্তা:
     ১. প্রতিটা মেসেজের পরিচয় (সময়+প্রেরক+নম্বর+টাকা) — একই মেসেজ দুইবার সেভ হয় না
     ২. চাওয়া (সালাম) বনাম পাঠানো (হাসান) মেলানো
     ৩. সন্দেহজনক টাকা / ভুল নম্বর / টাকা ছাড়া নম্বর — চুপচাপ বাদ পড়ে না
   ============================================================ */

/* চ্যাটে কে টাকা পাঠায় আর কে চায় — নাম বদলালে এখানে বদলান */
const SENDER_MATCH = /hasan|হাসান/i;      // যে পাঠায় — হিসাব এর মেসেজ থেকে হয়
const REQUESTER_MATCH = /salam|সালাম/i;   // যে চায় — শুধু মিলিয়ে দেখার জন্য

const AMOUNT_MIN_OK = 100;        // এর নিচে হলে সতর্কতা
const AMOUNT_MAX_OK = 500000;     // এর উপরে হলে সতর্কতা
const LIST_MSG_MIN = 6;           // এক মেসেজে এতগুলো এন্ট্রি = রাতের তালিকা, এন্ট্রি নয়

/* Bengali digits → English, strip invisible chars, normalise odd dashes */
function cleanText(s) {
    return App.fromBn(String(s || ''))
        .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
        .replace(/[  ]/g, ' ')
        .replace(/[‐-―−]/g, '-');
}

/* BD mobile: 01[3-9] + 8 digits = 11 digits.
   Tolerates "88" / "+88" / "0088" prefix and a single space / dot / dash
   between digits.  Digits glued straight onto the 11 digits (typo like
   017858528333) are captured so they never become the amount. */
const PHONE_RE = /(?<!\d)(?:(?:\+|00)?88[ .\-]?)?(0[ .\-]?1[ .\-]?[3-9](?:[ .\-]?\d){8})(\d*)/g;

function splitByPhone(body) {
    const hits = [];
    let m;
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(body))) {
        hits.push({
            number: m[1].replace(/\D/g, ''),
            start: m.index,
            end: m.index + m[0].length,
            glued: m[2]
        });
    }
    return hits.map((h, i) => ({
        number: h.number,
        glued: h.glued,
        start: h.start,
        end: h.end,
        after: body.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : body.length)
    }));
}

/* digit runs that look like a mobile number but have the wrong digit count.
   (bank account / routing numbers are NOT treated as wrong phone numbers) */
function findBadNumbers(body, parts) {
    const bad = [];
    const re = /\d+/g;
    let m;
    while ((m = re.exec(body))) {
        const s0 = m.index, e0 = s0 + m[0].length;
        if (parts.some(p => s0 < p.end && e0 > p.start)) continue;
        const core = m[0].replace(/^(?:00)?88(?=0?1)/, '');
        const len = core.length;
        const phoneLike =
            (/^01/.test(core) && len >= 8 && len <= 13 && len !== 11) ||
            (/^1[3-9]/.test(core) && len === 10);
        if (phoneLike) bad.push({ digits: len });
    }
    if (!bad.length && !parts.length &&
        /^(?:(?:\+|00)?88[ .\-]?)?0[ .\-]?1[ .\-]?\d/.test(body)) {
        bad.push({ digits: null });
    }
    return bad;
}

const PIN_RE = /(?<![a-z])p[io][nm]\s*[:;=\-]?\s*\d+|পিন\s*[:;=\-]?\s*\d+/gi;
const AMT_RE = /\d[\d,'’‘′]*(?:\.\d+)?/;

/* first positive number in text.  Accepted grouping: , ' ’ ‘ ′
   Returns { amount, problem } — problem is set when the writing is ambiguous
   ("10 200", "10.200", "5k") so the line is stopped instead of guessed. */
function readAmount(text) {
    const t = cleanText(text).replace(PIN_RE, ' ');
    const m = t.match(AMT_RE);
    if (!m) return null;
    const rawNum = m[0];
    const rest = t.slice(m.index + rawNum.length);
    let problem = null;
    if (/^\d{1,3}$/.test(rawNum) && /^[ \t]+\d{3}(?!\d)/.test(rest)) problem = 'টাকার মাঝে ফাঁকা আছে';
    else if (/^\d{1,3}\.\d{3}$/.test(rawNum)) problem = 'টাকায় ডট (.) আছে';
    else if (/^\s?k(?![a-z])/i.test(rest)) problem = '"k" দিয়ে লেখা টাকা';
    const amount = parseFloat(rawNum.replace(/[,'’‘′]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { amount, problem };
}

/* kept for old callers */
function extractAmount(text) {
    const a = readAmount(text);
    return a ? a.amount : null;
}

const SKIP_RE = /^(?:<Media omitted>|This message was deleted|You deleted this message)$/i;
const SPLIT_RE = /^(\d[\d,]*)\s*-{3,}\s*\d/;          // "50000-------680"
const badReason = n => n
    ? `নম্বর ভুল: ${n} ডিজিট (১১ ডিজিট হতে হবে)`
    : 'নম্বর ভুল: ১১ ডিজিট নয়';

/* one message (or one plain paste) → entries / errors / numbers without amount */
function parseBlock(text) {
    const entries = [], errors = [], loose = [];
    let pending = null, last = null;

    for (const raw of cleanText(text).split(/\r?\n/)) {
        const body = raw.trim();
        if (!body || SKIP_RE.test(body)) continue;

        const parts = splitByPhone(body);
        const bad = findBadNumbers(body, parts);
        bad.forEach(b => errors.push({ line: body, reason: badReason(b.digits) }));

        if (parts.length) {
            if (pending) { loose.push(pending); pending = null; }
            for (const p of parts) {
                if (p.glued) {
                    errors.push({ line: body, reason: badReason(11 + p.glued.length) });
                    pending = null;
                    continue;
                }
                const a = readAmount(p.after);
                if (!a) { pending = { number: p.number, line: body }; continue; }
                if (a.problem) { errors.push({ line: body, reason: a.problem + ' — ঠিক করে লিখুন' }); continue; }
                last = { number: p.number, amount: a.amount, line: body, splits: [] };
                entries.push(last);
            }
        } else if (bad.length) {
            pending = null;
        } else if (pending) {
            /* continuation line (e.g. "40,000/=" under the phone) */
            const a = readAmount(body);
            if (a) {
                if (a.problem) errors.push({ line: pending.line + ' ⏎ ' + body, reason: a.problem + ' — ঠিক করে লিখুন' });
                else {
                    last = { number: pending.number, amount: a.amount, line: pending.line + ' ⏎ ' + body, splits: [] };
                    entries.push(last);
                }
                pending = null;
            }
        } else if (last) {
            const s = body.match(SPLIT_RE);
            if (s) last.splits.push(parseFloat(s[1].replace(/,/g, '')));
        }
    }
    if (pending) loose.push(pending);
    return { entries, errors, loose };
}

/* ---------- WhatsApp message headers ---------- */
/* "[2026-10-06, 19:44] Name: text"   (made by this app when a chat file is loaded) */
const HDR_ISO = /^\[(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2})\]\s([^:\n]{1,60}?):(?:\s(.*)|$)/;
/* "[10/6, 7:44 AM] Name: text"  /  "10/6/26, 7:44 AM - Name: text"  /  "[06/10/26, 19:44:05] Name: text" */
const HDR_SLASH = /^\[?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?,\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([AP])\.?\s?M\.?)?\]?\s*(?:-\s*)?([^:\n]{1,60}?):(?:\s(.*)|$)/i;

const pad2 = n => String(n).padStart(2, '0');
const localKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/* text → [{ ts, sender, text }]   (refDate "YYYY-MM-DD" helps guess year and day/month order) */
function parseChat(text, refDate) {
    const lines = cleanText(text).split(/\r?\n/);
    const rawMsgs = [];
    let hasHeaders = false;

    /* a text uses ONE header style ("[..] Name:" when copied, "date - Name:" in an exported file).
       Lines in the other style are message text (e.g. a forwarded copy), not new messages. */
    let nBr = 0, nDash = 0;
    for (const line of lines) {
        if (HDR_ISO.test(line)) nBr++;
        else if (HDR_SLASH.test(line)) { if (line[0] === '[') nBr++; else nDash++; }
    }
    const useBracket = nBr >= nDash;

    for (const line of lines) {
        if ((line[0] === '[') !== useBracket) {
            if (rawMsgs.length) rawMsgs[rawMsgs.length - 1].text += '\n' + line;
            else rawMsgs.push({ headerless: true, text: line });
            continue;
        }
        let m = line.match(HDR_ISO);
        if (m) {
            hasHeaders = true;
            rawMsgs.push({ iso: true, y: +m[1], a: +m[2], b: +m[3], h: +m[4], mi: +m[5], sender: m[6].trim(), text: m[7] || '' });
            continue;
        }
        m = line.match(HDR_SLASH);
        if (m) {
            hasHeaders = true;
            let h = +m[4];
            if (m[6]) h = (h % 12) + (/p/i.test(m[6]) ? 12 : 0);
            rawMsgs.push({ iso: false, y: m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null, a: +m[1], b: +m[2], h, mi: +m[5], sender: m[7].trim(), text: m[8] || '' });
            continue;
        }
        if (rawMsgs.length) rawMsgs[rawMsgs.length - 1].text += '\n' + line;
        else rawMsgs.push({ headerless: true, text: line });
    }
    if (!hasHeaders) return { hasHeaders: false, msgs: [] };

    /* day/month order for slash dates: decide from the data, else by closeness to refDate, else M/D */
    const ref = refDate ? new Date(refDate + 'T12:00:00') : new Date();
    const slash = rawMsgs.filter(r => !r.iso && !r.headerless);
    let order = 'MD';
    if (slash.some(r => r.a > 12)) order = 'DM';
    else if (slash.some(r => r.b > 12)) order = 'MD';
    else if (slash.length) {
        const score = ord => slash.reduce((s, r) => {
            const mo = ord === 'MD' ? r.a : r.b, d = ord === 'MD' ? r.b : r.a;
            const dt = new Date(r.y || ref.getFullYear(), mo - 1, d, 12);
            return s + (Math.abs(dt - ref) <= 4 * 86400000 ? 1 : 0);
        }, 0);
        if (score('DM') > score('MD')) order = 'DM';
    }

    const msgs = [];
    for (const r of rawMsgs) {
        if (r.headerless) { if (r.text.trim()) msgs.push({ ts: null, sender: '', text: r.text }); continue; }
        let y = r.y, mo, d;
        if (r.iso) { mo = r.a; d = r.b; }
        else { mo = order === 'MD' ? r.a : r.b; d = order === 'MD' ? r.b : r.a; }
        if (!y) {
            y = ref.getFullYear();
            const guess = new Date(y, mo - 1, d, 12);
            if (guess - ref > 30 * 86400000) y -= 1;          // pasted in January, message from December
            else if (ref - guess > 335 * 86400000) y += 1;
        }
        msgs.push({ ts: new Date(y, mo - 1, d, r.h, r.mi), sender: r.sender, text: r.text });
    }
    return { hasHeaders: true, msgs, order };
}

const SUMMARY_RE = /পাওনা|টোটাল|টি নম্বর|এন্ট্রি\s*:|মোট এন্ট্রি|সর্বমোট|ইজা\s*[-:]/;
const roleOf = sender => SENDER_MATCH.test(sender) ? 'send' : REQUESTER_MATCH.test(sender) ? 'ask' : 'other';

/* can `target` be made by adding up some of `nums`? (small lists only) */
function subsetSum(nums, target) {
    if (nums.length > 12) return false;
    const n = nums.length;
    for (let mask = 1; mask < (1 << n); mask++) {
        let s = 0;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) s += nums[i];
        if (s === target) return true;
    }
    return false;
}

/* index of what is already saved:  message ids + old (id-less) entries per date */
function buildSavedIndex(recs) {
    const ids = new Set();
    const legacy = {};
    for (const r of recs || []) {
        for (const e of r.entries || []) {
            if (e.msgId) ids.add(e.msgId);
            else {
                const m = legacy[r.date] || (legacy[r.date] = {});
                const k = e.number + '|' + e.amount;
                m[k] = (m[k] || 0) + 1;
            }
        }
    }
    return { ids, legacy };
}

/* time of the newest saved message (falls back to the newest save time) */
function latestSavedAt(recs) {
    let best = null, created = null;
    for (const r of recs || []) {
        for (const e of r.entries || []) {
            if (!e.at) continue;
            const t = new Date(e.at);
            if (!isNaN(t) && (!best || t > best)) best = t;
        }
        const c = r.createdAt && new Date(r.createdAt.$date || r.createdAt);
        if (c && !isNaN(c) && (!created || c > created)) created = c;
    }
    return best || created;
}

/* ============================================================
   analyze(text, date, savedIndex)
   → { entries, total, errors, reds, infos, skippedSaved, mode }
       errors : সেভ হবে না — লেখা ঠিক করতে হবে
       reds   : দেখে নিশ্চিত করলে তবেই সেভ হবে
       infos  : শুধু জানার জন্য
   ============================================================ */
function analyze(text, date, saved) {
    saved = saved || { ids: new Set(), legacy: {} };
    const res = { entries: [], total: 0, errors: [], reds: [], infos: [], skippedSaved: 0, mode: 'plain' };
    const fmtT = d => d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
    const money = n => Number(n).toLocaleString('en-US');

    const chat = parseChat(text, date);
    let sendEntries = [];      // everything the sender wrote in this paste (before removing already-saved)
    const askEntries = [];

    if (!chat.hasHeaders) {
        /* ---------- plain paste: lines / a ready-made list ---------- */
        const b = parseBlock(text);
        res.errors.push(...b.errors);
        b.loose.forEach(l => res.reds.push({ kind: 'loose', text: `টাকা ছাড়া নম্বর: ${l.number}`, line: l.line }));
        sendEntries = b.entries.map(e => ({ ...e, at: null, msgId: null }));
        res.infos.push({ kind: 'mode', text: 'মেসেজে সময় ও নাম নেই — চাওয়া/পাঠানো মেলানো এবং মেসেজ-পরিচয় দিয়ে ডুপ্লিকেট ধরা সম্ভব হয়নি' });
    } else {
        /* ---------- WhatsApp chat ---------- */
        res.mode = 'chat';
        const hasSend = chat.msgs.some(m => roleOf(m.sender) === 'send');
        let lists = 0, notEntry = 0;
        const seenId = {};

        for (const m of chat.msgs) {
            const role = roleOf(m.sender);
            const isSource = hasSend ? role === 'send' : true;
            if (!m.text.trim() || m.text.split('\n').every(l => !l.trim() || SKIP_RE.test(l.trim()))) continue;
            if (SUMMARY_RE.test(m.text)) { lists++; continue; }

            const b = parseBlock(m.text);
            if (b.entries.length >= LIST_MSG_MIN) { lists++; continue; }

            if (isSource) {
                b.errors.forEach(e => res.errors.push({ line: `[${fmtT(m.ts)}] ${e.line}`, reason: e.reason }));
                b.loose.forEach(l => res.reds.push({ kind: 'loose', text: `টাকা ছাড়া নম্বর: ${l.number}`, line: `[${fmtT(m.ts)}] ${l.line}` }));
                if (!b.entries.length && !b.errors.length && !b.loose.length && /\d{4,}/.test(m.text)) notEntry++;
                for (const e of b.entries) {
                    const base = `${m.ts ? localKey(m.ts) : 'x'}|${m.sender.toLowerCase().replace(/\s+/g, ' ')}|${e.number}|${e.amount}`;
                    const k = seenId[base] = (seenId[base] || 0) + 1;
                    sendEntries.push({ ...e, at: m.ts ? m.ts.toISOString() : null, msgId: m.ts ? `${base}|${k}` : null, when: fmtT(m.ts) });
                }
            } else if (role === 'ask') {
                b.entries.forEach(e => askEntries.push({ ...e, when: fmtT(m.ts) }));
            }
        }
        if (!hasSend) res.infos.push({ kind: 'mode', text: 'এই লেখায় পাঠানোর (হাসানের) মেসেজ নেই — যা আছে তা থেকেই এন্ট্রি নেওয়া হয়েছে, চাওয়া/পাঠানো মেলানো হয়নি' });
        if (lists) res.infos.push({ kind: 'lists', text: `${lists} টা হিসাব/তালিকা মেসেজ এন্ট্রি হিসেবে ধরা হয়নি` });
        if (notEntry) res.infos.push({ kind: 'notentry', text: `${notEntry} টা সংখ্যা-ওয়ালা মেসেজে কোনো মোবাইল নম্বর নেই — বাদ` });

        /* ---------- চাওয়া বনাম পাঠানো ---------- */
        if (hasSend && askEntries.length) {
            const g = {};
            sendEntries.forEach(e => (g[e.number] || (g[e.number] = { sent: [], asked: [] })).sent.push(e.amount));
            askEntries.forEach(e => (g[e.number] || (g[e.number] = { sent: [], asked: [] })).asked.push(e.amount));
            let onlySent = 0;
            const notSent = [];
            for (const num of Object.keys(g)) {
                const { sent, asked } = g[num];
                const S = sent.reduce((a, c) => a + c, 0), A = asked.reduce((a, c) => a + c, 0);
                if (!asked.length) { onlySent++; continue; }
                if (!sent.length) { notSent.push(`${num} = ${money(A)}`); continue; }
                if (S === A) continue;
                if (S < A) {
                    if (subsetSum(asked, S)) notSent.push(`${num}: চাওয়া ${money(A)}, পাঠানো ${money(S)}`);
                    else res.reds.push({ kind: 'less', text: `${num}: চাওয়া ${money(A)}, পাঠানো ${money(S)} — ${money(A - S)} কম`, line: `পাঠানো: ${sent.map(money).join(' + ')}` });
                } else {
                    res.reds.push({ kind: 'more', text: `${num}: চাওয়া ${money(A)}, পাঠানো ${money(S)} — ${money(S - A)} বেশি`, line: `পাঠানো: ${sent.map(money).join(' + ')}  |  চাওয়া: ${asked.map(money).join(' + ')}` });
                }
            }
            if (notSent.length) res.infos.push({ kind: 'notsent', text: `চাওয়া হয়েছে কিন্তু পাঠানোর মেসেজ নেই (${notSent.length})`, list: notSent });
            if (onlySent) res.infos.push({ kind: 'onlysent', text: `${onlySent} টা নম্বরে পাঠানো হয়েছে, কিন্তু চাওয়ার লেখা মেসেজ পাওয়া যায়নি (ছবি/আগের দিনের হতে পারে)` });
        }
    }

    /* ---------- আগে সেভ হওয়া মেসেজ বাদ ---------- */
    const fresh = [];
    for (const e of sendEntries) {
        if (e.msgId && saved.ids.has(e.msgId)) { res.skippedSaved++; continue; }
        fresh.push(e);
    }
    if (res.skippedSaved) res.infos.push({ kind: 'saved', text: `${res.skippedSaved} টা এন্ট্রি আগেই সেভ আছে — আবার যোগ করা হয়নি` });

    /* ---------- ডুপ্লিকেট / সন্দেহজনক টাকা ---------- */
    const legacy = (saved.legacy && saved.legacy[date]) || {};
    const count = {};
    fresh.forEach(e => { const k = e.number + '|' + e.amount; count[k] = (count[k] || 0) + 1; });
    const told = new Set();
    for (const e of fresh) {
        const k = e.number + '|' + e.amount;
        if (!told.has(k)) {
            if (legacy[k]) res.reds.push({ kind: 'dup', text: `${e.number} = ${money(e.amount)} — এই তারিখে আগে থেকেই সেভ আছে`, line: e.line });
            if (count[k] > 1) {
                if (res.mode === 'plain') res.reds.push({ kind: 'dup', text: `${e.number} = ${money(e.amount)} — এই লেখায় ${count[k]} বার আছে`, line: e.line });
                else res.infos.push({ kind: 'repeat', text: `${e.number} = ${money(e.amount)} — ${count[k]} টা আলাদা মেসেজে আছে` });
            }
            told.add(k);
        }
        if (e.amount < AMOUNT_MIN_OK) res.reds.push({ kind: 'small', text: `${e.number} = ${money(e.amount)} — টাকা খুব কম, ঠিক আছে?`, line: e.line });
        if (e.amount > AMOUNT_MAX_OK) res.reds.push({ kind: 'big', text: `${e.number} = ${money(e.amount)} — টাকা অস্বাভাবিক বড়, ঠিক আছে?`, line: e.line });
        if (e.splits && e.splits.length) {
            const s = e.splits.reduce((a, c) => a + c, 0);
            if (s !== e.amount) res.reds.push({ kind: 'split', text: `${e.number} = ${money(e.amount)} — নিচের ভাগের যোগফল ${money(s)}`, line: e.splits.map(money).join(' + ') });
        }
    }

    res.entries = fresh.map(e => {
        const o = { number: e.number, amount: e.amount };
        if (e.at) o.at = e.at;
        if (e.msgId) o.msgId = e.msgId;
        return o;
    });
    res.total = res.entries.reduce((s, e) => s + e.amount, 0);
    return res;
}

/* old name — some code may still call it */
function parseEntries(text) {
    const b = parseBlock(text);
    const out = b.entries.map(e => ({ number: e.number, amount: e.amount }));
    out.errors = b.errors;
    out.warnings = b.loose.map(l => `amount missing for ${l.number}`);
    return out;
}

/* a whole exported chat → text for the box, only messages from `from` onward */
function chatFileToText(msgs, from, until) {
    const out = [];
    for (const m of msgs) {
        if (!m.ts || (from && m.ts < from) || (until && m.ts > until)) continue;
        const body = m.text.split('\n').filter(l => !SKIP_RE.test(l.trim())).join('\n').trim();
        if (!body) continue;
        const d = m.ts;
        out.push(`[${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}] ${m.sender}: ${body}`);
    }
    return out.join('\n');
}
