/* হিসাব চেকার — এক ফাইলে সব: (১) সাধারণ ফাংশন  (২) মেসেজ পড়ার নিয়ম  (৩) চেকার */

/* ============================================================
   ইজি লেনদেন — shared helpers
   ------------------------------------------------------------
   সব পেজ এই ফাইলটা নিজের script.js-এর আগে লোড করে।
   এখানে যা আছে তা `App.` দিয়ে পাওয়া যায়, যেমন App.money(500)।
   ============================================================ */
const App = (() => {
    /* ---------- text ---------- */
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /* ---------- numbers ---------- */
    const BN_TO_EN = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
    const fromBn = s => String(s).replace(/[০-৯]/g, d => BN_TO_EN[d] || d);

    /* "১২,৫০০ টাকা" → 12500 */
    function parseNum(str) {
        const n = parseFloat(fromBn(str).replace(/[^\d.\-]/g, ''));
        return Number.isFinite(n) ? n : 0;
    }

    /* 1234567 → "1,234,567" */
    const num = n => Number(n || 0).toLocaleString('en-US');

    /* 1234567 → "৳12,34,567"   (-500 → "-৳500") */
    function money(n) {
        const v = Number(n || 0);
        return (v < 0 ? '-' : '') + '৳' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    }

    /* ---------- dates ---------- */
    const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
        'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
    const WEEKDAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

    /* "2026-11" → "নভেম্বর" */
    const monthName = ym => MONTHS[+ym.split('-')[1] - 1];

    /* "2026-11-12" → "বৃহস্পতিবার" */
    const weekday = iso => {
        const [y, m, d] = iso.split('-').map(Number);
        return WEEKDAYS[new Date(y, m - 1, d).getDay()];
    };

    /* আজকের তারিখ "YYYY-MM-DD" (ফোনের সময় অনুযায়ী) */
    function todayStr(d = new Date()) {
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }

    /* ISO সময় → "12/11/26 · 7:45 PM" */
    function fmtDateTime(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: '2-digit' });
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return `${date} · ${time}`;
    }

    /* ---------- toast ---------- */
    let toastTimer = null;

    /* App.toast('সেভ হয়েছে', 'ok')  ·  kind: 'ok' | 'err' | ''
       opts: { actionLabel, onAction, duration } */
    function toast(msg, kind = '', opts = {}) {
        const el = document.getElementById('toast');
        if (!el) return;
        const type = kind === 'ok' || kind === 'success' ? 'ok'
            : kind === 'err' || kind === 'error' ? 'err' : '';

        el.textContent = '';
        if (type) {
            const icon = document.createElement('span');
            icon.className = 'toast-icon';
            icon.textContent = type === 'ok' ? '✓' : '!';
            el.appendChild(icon);
        }
        const text = document.createElement('span');
        text.className = 'toast-msg';
        text.textContent = msg;
        el.appendChild(text);

        if (opts.actionLabel && typeof opts.onAction === 'function') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toast-action';
            btn.textContent = opts.actionLabel;
            btn.onclick = () => { hideToast(); opts.onAction(); };
            el.appendChild(btn);
        }

        el.className = 'toast show ' + type;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, opts.duration || (opts.actionLabel ? 4500 : 2400));
    }

    function hideToast() {
        const el = document.getElementById('toast');
        if (el) el.classList.remove('show');
        clearTimeout(toastTimer);
    }

    /* ---------- clipboard ---------- */
    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            return true;
        } catch {
            return false;
        }
    }

    /* ---------- brand logo  (<div class="brand-logo"></div> ফাঁকা থাকলে নিজে বসে) ---------- */
    const LOGO = `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
                <linearGradient id="el-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#e8437a" />
                    <stop offset="55%" stop-color="#d12053" />
                    <stop offset="100%" stop-color="#a8153f" />
                </linearGradient>
            </defs>
            <rect width="100" height="100" rx="24" fill="url(#el-grad)" />
            <path d="M0 24 Q0 0 24 0 L76 0 Q100 0 100 24 L100 34 Q60 54 0 54 Z" fill="rgba(255,255,255,0.10)" />
            <text x="50" y="74" text-anchor="middle" font-family="'Noto Sans Bengali','Hind Siliguri',sans-serif"
                  font-size="60" font-weight="800" fill="#ffffff">ই</text>
            <circle cx="80" cy="22" r="5.5" fill="#ffffff" />
            <circle cx="80" cy="22" r="2.2" fill="#d12053" />
        </svg>`;

    function mountChrome() {
        document.querySelectorAll('.brand-logo').forEach(el => {
            if (!el.children.length) el.innerHTML = LOGO;
        });
        const topbar = document.querySelector('.topbar');
        if (topbar) {
            window.addEventListener('scroll',
                () => topbar.classList.toggle('scrolled', window.scrollY > 8), { passive: true });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountChrome);
    else mountChrome();

    /* ---------- জুম, কপি ও রাইট-ক্লিক বন্ধ (যে পেজে দরকার সে ডাকে) ---------- */
    function lockZoomAndCopy() {
        const editable = t => {
            const tag = (t.tagName || '').toLowerCase();
            return tag === 'input' || tag === 'textarea' || t.isContentEditable;
        };
        const stop = e => e.preventDefault();

        document.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false });
        ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, stop));
        ['touchstart', 'touchmove'].forEach(ev =>
            document.addEventListener(ev, e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false }));

        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && !editable(e.target) &&
                ['c', 'a', 'x', 's', 'u'].includes(e.key.toLowerCase())) e.preventDefault();
        });
        document.addEventListener('contextmenu', e => { if (!editable(e.target)) e.preventDefault(); });
    }

    return {
        esc, fromBn, parseNum, num, money,
        MONTHS, WEEKDAYS, monthName, weekday, todayStr, fmtDateTime,
        toast, hideToast, copyText, lockZoomAndCopy,
    };
})();

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

/* ============================================================
   হিসাব চেকার
   ------------------------------------------------------------
   দুই বক্সে দুই পক্ষের মেসেজ → নম্বর ধরে ধরে টাকা মিলিয়ে দেখা।
   সার্ভারে কিছু যায় না — লেখা শুধু এই ব্রাউজারের localStorage এ থাকে।
   মেসেজ পড়ার নিয়ম Entry পেজের মতোই (/shared/parser.js)।
   ============================================================ */
const { esc, num, toast, copyText, fmtDateTime } = App;
const $ = id => document.getElementById(id);

/* ============================================================
   LOCAL STORAGE — দুই বক্সের লেখা এই ফোন/ব্রাউজারে থেকে যায়
   ============================================================ */
const STORE_KEY = 'easy_lenden_checker_v1';

function loadSaved() {
    try {
        const d = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        return { salam: String(d.salam || ''), hasan: String(d.hasan || ''), checked: !!d.checked };
    } catch (e) {
        return { salam: '', hasan: '', checked: false };
    }
}

function save(checked) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
            salam: $('salamInput').value, hasan: $('hasanInput').value, checked: !!checked, savedAt: Date.now()
        }));
    } catch (e) {
        toast('সেভ করা গেল না — ব্রাউজারের জায়গা শেষ বা সেভ বন্ধ', 'err');
    }
}

/* এক পক্ষের লেখা → { byNumber: Map(number → [amount…]), total, count, errors } */
function readSide(text) {
    const parsed = parseEntries(text);
    const byNumber = new Map();
    for (const e of parsed) {
        if (!byNumber.has(e.number)) byNumber.set(e.number, []);
        byNumber.get(e.number).push(e.amount);
    }
    const errors = (parsed.errors || []).map(e => ({ line: e.line, reason: e.reason }));
    for (const w of parsed.warnings || []) {
        const n = (w.match(/\d{11}/) || [''])[0];
        errors.push({ line: n, reason: 'এই নম্বরের টাকা লেখা নেই' });
    }
    return { byNumber, errors, count: parsed.length, total: parsed.reduce((s, e) => s + e.amount, 0) };
}

const sum = a => a.reduce((s, n) => s + n, 0);

/* দুই পক্ষ → প্রতি নম্বরে এক সারি */
function compare(salam, hasan) {
    const numbers = [...new Set([...salam.byNumber.keys(), ...hasan.byNumber.keys()])];
    const rows = numbers.map(number => {
        const s = salam.byNumber.get(number) || [];
        const h = hasan.byNumber.get(number) || [];
        const status = !h.length ? 'onlySalam' : !s.length ? 'onlyHasan' : sum(s) === sum(h) ? 'ok' : 'diff';
        return { number, s, h, sSum: sum(s), hSum: sum(h), status };
    });
    return rows;   /* সিরিয়াল = মেসেজে যে ক্রমে এসেছে (আগে সালামের ক্রম, তারপর শুধু হাসানে থাকা নম্বর) */
}

const LABEL = {
    ok: 'মিলেছে',
    diff: 'টাকা মেলেনি',
    onlySalam: 'হাসানে নেই',
    onlyHasan: 'সালামে নেই'
};

const fmtNumber = n => n.slice(0, 5) + '-' + n.slice(5);
const parts = a => a.length > 1 ? `<small>${a.map(num).join(' + ')}</small>` : '';

function renderErrors(el, errors) {
    el.hidden = !errors.length;
    el.innerHTML = errors.map(e => `
        <div class="err-row"><b>${esc(e.reason)}</b>${e.line ? `<span>${esc(e.line)}</span>` : ''}</div>`).join('');
}

function renderResult(salam, hasan, rows, noScroll) {
    const bad = rows.filter(r => r.status !== 'ok');
    const gap = hasan.total - salam.total;
    const allOk = !bad.length;

    $('result').hidden = false;
    $('result').innerHTML = `
        <div class="verdict ${allOk ? 'good' : 'bad'}">
            <b>${allOk ? 'সব মিলেছে' : num(bad.length) + ' টি নম্বরে গরমিল'}</b>
            <span>${allOk
            ? num(rows.length) + ' টি নম্বর, দুই পক্ষের টাকা সমান'
            : 'মোট ' + num(rows.length) + ' টি নম্বরের মধ্যে ' + num(rows.length - bad.length) + ' টি মিলেছে'}</span>
        </div>

        <div class="totals">
            <div><span>সালাম</span><b>৳ ${num(salam.total)}</b><small>${num(salam.count)} টি এন্ট্রি</small></div>
            <div><span>হাসান</span><b>৳ ${num(hasan.total)}</b><small>${num(hasan.count)} টি এন্ট্রি</small></div>
            <div class="${gap ? 'gap' : ''}"><span>পার্থক্য</span><b>${gap ? (gap > 0 ? '+' : '−') + '৳ ' + num(Math.abs(gap)) : '৳ 0'}</b><small>${gap > 0 ? 'হাসানে বেশি' : gap < 0 ? 'হাসানে কম' : 'সমান'}</small></div>
        </div>

        <div class="copy-bar">
            <span>কপি করুন</span>
            <button type="button" data-copy="s"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>সালাম</button>
            <button type="button" data-copy="h"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>হাসান</button>
            <button type="button" data-copy="diff"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>গরমিল</button>
        </div>

        <div class="section-head">
            <div class="section-title"><span class="title-dot"></span>নম্বর ধরে</div>
            <span class="section-count">${num(rows.length)} টি</span>
        </div>

        <div class="rows">
            <div class="row row-head"><span>#</span><span>নম্বর</span><span>সালাম</span><span>হাসান</span></div>
            ${rows.map((r, i) => `
            <div class="row ${r.status}">
                <span class="sl">${i + 1}</span>
                <span class="num">${fmtNumber(r.number)}<em>${LABEL[r.status]}${r.status === 'diff' ? ' · ' + (r.hSum > r.sSum ? '+' : '−') + num(Math.abs(r.hSum - r.sSum)) : ''}</em></span>
                <span class="amt">${r.s.length ? num(r.sSum) : '—'}${parts(r.s)}</span>
                <span class="amt">${r.h.length ? num(r.hSum) : '—'}${parts(r.h)}</span>
            </div>`).join('')}
        </div>`;
    if (!noScroll) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ============================================================
   COPY — রাফ হিসাবের মতো সাজানো লেখা
   ============================================================ */
let last = null;   // সর্বশেষ মিলানো: { salam, hasan, rows }
const LINE = '━━━━━━━━━━━━━━━━━━━━';

/* এক পক্ষের তালিকা: who = 's' (সালাম) | 'h' (হাসান) */
function buildSideText(who) {
    const name = who === 's' ? 'সালাম' : 'হাসান';
    const side = who === 's' ? last.salam : last.hasan;
    const lines = [`📅 ${fmtDateTime(Date.now())}`, `${name}ের এন্ট্রি: ${side.count} টি`, LINE];
    last.rows.forEach(r => r[who].forEach(amount => lines.push(`${fmtNumber(r.number)} = ${amount}`)));
    lines.push(LINE, `মোট                = ${num(side.total)}`);
    return lines.join('\n');
}

/* শুধু গরমিলগুলো */
function buildDiffText() {
    const bad = last.rows.map((r, i) => ({ r, sl: i + 1 })).filter(x => x.r.status !== 'ok');
    const lines = [`📅 ${fmtDateTime(Date.now())}`];
    if (!bad.length) lines.push(`✅ সব মিলেছে — ${last.rows.length} টি নম্বর`);
    else {
        lines.push(`⚠️ গরমিল: ${bad.length} টি (মোট ${last.rows.length} টি নম্বর)`, LINE);
        bad.forEach(({ r, sl }) => {
            lines.push(`${sl}) ${fmtNumber(r.number)} — ${LABEL[r.status]}`);
            lines.push(`    সালাম ${r.s.length ? num(r.sSum) : 'নেই'} | হাসান ${r.h.length ? num(r.hSum) : 'নেই'}`);
        });
    }
    const gap = last.hasan.total - last.salam.total;
    lines.push(LINE, `সালাম মোট  = ${num(last.salam.total)}`, `হাসান মোট  = ${num(last.hasan.total)}`,
        `পার্থক্য     = ${gap ? (gap > 0 ? '+' : '−') + num(Math.abs(gap)) : '0'}`);
    return lines.join('\n');
}

document.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-copy]');
    if (!btn || !last) return;
    const kind = btn.dataset.copy;
    const ok = await copyText(kind === 'diff' ? buildDiffText() : buildSideText(kind));
    toast(ok ? 'কপি হয়েছে' : 'কপি ব্যর্থ', ok ? 'ok' : 'err');
});

function check(quiet) {
    const sText = $('salamInput').value.trim(), hText = $('hasanInput').value.trim();
    $('result').hidden = true;
    save(false);
    if (!sText || !hText) return quiet === true ? null : toast('দুই বক্সেই এন্ট্রি পেস্ট করুন', 'err');

    const salam = readSide(sText), hasan = readSide(hText);
    renderErrors($('salamErrs'), salam.errors);
    renderErrors($('hasanErrs'), hasan.errors);

    /* ভুল লাইন থাকলে মেলানো হয় না — নইলে ভুল ফলকে ঠিক মনে হতে পারে */
    const errCount = salam.errors.length + hasan.errors.length;
    if (errCount) return toast(num(errCount) + ' টি লাইনে ভুল — ঠিক করে আবার চাপুন', 'err');
    if (!salam.count || !hasan.count) return toast((salam.count ? 'হাসানের' : 'সালামের') + ' বক্সে কোনো এন্ট্রি পাওয়া যায়নি', 'err');

    save(true);
    last = { salam, hasan, rows: compare(salam, hasan) };
    renderResult(salam, hasan, last.rows, quiet === true);
}

$('checkBtn').onclick = () => check();
$('backBtn').onclick = () => { window.location.href = '/'; };
$('clearBtn').onclick = () => {
    ['salamInput', 'hasanInput'].forEach(id => { $(id).value = ''; });
    ['salamErrs', 'hasanErrs', 'result'].forEach(id => { $(id).hidden = true; });
    try { localStorage.removeItem(STORE_KEY); } catch (e) { }
};

document.querySelectorAll('[data-paste]').forEach(btn => {
    btn.onclick = async () => {
        try {
            $(btn.dataset.paste).value = await navigator.clipboard.readText();
            save(false);
        } catch (e) {
            toast('পেস্ট করা গেল না — বক্সে চেপে ধরে পেস্ট করুন', 'err');
        }
    };
});

/* লিখতে লিখতেই সেভ */
['salamInput', 'hasanInput'].forEach(id => $(id).addEventListener('input', () => save(false)));

/* পেজ খুললে আগের লেখা ফিরিয়ে আনা; আগেরবার মেলানো থাকলে ফলাফলও */
(function restore() {
    const d = loadSaved();
    $('salamInput').value = d.salam;
    $('hasanInput').value = d.hasan;
    if (d.checked) check(true);
})();