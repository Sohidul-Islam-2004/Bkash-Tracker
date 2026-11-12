/* ============================================================
   STORAGE
   ============================================================ */
const STORAGE_KEY = 'raf_hisab_entries_v1';

let entries = [];
let deleteTarget = null;

function load() {
    try {
        entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(entries)) entries = [];
    } catch {
        entries = [];
    }
}

function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/* ============================================================
   HELPERS
   ============================================================ */
const bn = n => Number(n || 0).toLocaleString('en-US');

const BN_TO_EN = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
const fromBn = s => String(s).replace(/[০-৯]/g, d => BN_TO_EN[d] || d);

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* only format real 11-digit phone numbers; leave anything else untouched */
const fmtNum = n => /^\d{11}$/.test(String(n)) ? n.slice(0, 5) + '-' + n.slice(5) : n;

function fmtDateTime(ts) {
    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const yr = d.getFullYear();
    let hr = d.getHours();
    const min = String(d.getMinutes()).padStart(2, '0');
    const ampm = hr >= 12 ? 'PM' : 'AM';
    hr = hr % 12 || 12;
    return `${day}/${mon}/${yr} • ${hr}:${min} ${ampm}`;
}

/* ============================================================
   PARSE  —  কড়া নিয়ম, যেন ভুল চুপচাপ পার না হয়
   ------------------------------------------------------------
   প্রতি লাইনে, এই ক্রমে:

     ১. বাদ          — খালি লাইন / <Media omitted> / মুছে ফেলা মেসেজ
     ২. নম্বর মোড     — লাইনে ১১-ডিজিট নম্বর আছে
                        → টাকা = নম্বরের পরের প্রথম সংখ্যা
                        → লাইনের নাম/লেখা ধরা হয় না
                        → পিন নম্বর টাকা হিসেবে ধরা হয় না
                        → ভুল ডিজিটের নম্বর → লাল ভুল
     ৩. পরের লাইন    — আগের নম্বরের টাকা এখনো পাওয়া যায়নি
                        → এই লাইনের সংখ্যাটাই তার টাকা

   যে লেখাগুলো আন্দাজ করা হয় না, থামিয়ে দেওয়া হয় (লাল ভুল):
     "10 200" (মাঝে ফাঁকা) · "10.200" (ডট) · "5k" · ১১ ডিজিটের কম-বেশি নম্বর

   যেগুলো ভুল নাও হতে পারে, সতর্কতা হিসেবে দেখানো হয় (আবার সেভ চাপলে যায়):
     টাকা ছাড়া নম্বর · খুব কম/বেশি টাকা · একই নম্বর একাধিকবার · ভাগের যোগফল না মেলা
   ============================================================ */

const AMOUNT_MIN_OK = 100;        // এর নিচে হলে সতর্কতা
const AMOUNT_MAX_OK = 500000;     // এর উপরে হলে সতর্কতা

/* Bengali digits → English, strip invisible chars, normalise odd dashes */
function cleanText(s) {
    return fromBn(String(s || ''))
        .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
        .replace(/[  ]/g, ' ')
        .replace(/[‐-―−]/g, '-');
}

/* BD mobile: 01[3-9] + 8 digits = 11 digits.
   Tolerates "88" / "+88" / "0088" prefix and a single space / dot / dash
   between digits.  Digits glued straight onto the 11 digits (typo like
   017858528333) are captured so they never become the amount. */
const PHONE_RE = /(?<!\d)(?:(?:\+|00)?88[ .\-]?)?(0[ .\-]?1[ .\-]?[3-9](?:[ .\-]?\d){8})(\d*)/g;

/* every phone in a line, with the text that follows it (up to the next phone) */
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
   (ব্যাংক একাউন্ট নম্বরকে ভুল মোবাইল নম্বর ধরা হয় না) */
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

const SKIP_RE = /^(?:<Media omitted>|This message was deleted|You deleted this message)$/i;
const SPLIT_RE = /^(\d[\d,]*)\s*-{3,}\s*\d/;          // "50000-------680"
const badReason = n => n
    ? `নম্বর ভুল: ${n} ডিজিট (১১ ডিজিট হতে হবে)`
    : 'নম্বর ভুল: ১১ ডিজিট নয়';

/* পেস্ট করা পুরো লেখা → এন্ট্রি / ভুল / টাকা ছাড়া নম্বর */
function parseBlock(text) {
    const entries = [], errors = [], loose = [];
    let pending = null, last = null, seq = 0;   // seq = পেস্টে নম্বরটা কত নম্বরে আছে

    for (const raw of cleanText(text).split(/\r?\n/)) {
        const body = raw.trim();
        if (!body || SKIP_RE.test(body)) continue;

        const parts = splitByPhone(body);
        const bad = findBadNumbers(body, parts);
        bad.forEach(b => errors.push({ line: body, reason: badReason(b.digits) }));

        if (parts.length) {
            if (pending) { loose.push(pending); pending = null; }
            for (const p of parts) {
                const order = ++seq;
                if (p.glued) {                                   // ১২+ ডিজিট একসাথে লেগে আছে
                    errors.push({ line: body, reason: badReason(11 + p.glued.length) });
                    pending = null;
                    continue;
                }
                const a = readAmount(p.after);
                if (!a) { pending = { number: p.number, line: body, order }; continue; }
                if (a.problem) { errors.push({ line: body, reason: a.problem + ' — ঠিক করে লিখুন' }); continue; }
                last = { number: p.number, amount: a.amount, line: body, splits: [], order };
                entries.push(last);
            }
        } else if (bad.length) {
            pending = null;
        } else if (pending) {
            /* আগের নম্বরের টাকা এই লাইনে (যেমন নম্বরের নিচে "40,000/=") */
            const a = readAmount(body);
            if (a) {
                if (a.problem) errors.push({ line: pending.line + ' ⏎ ' + body, reason: a.problem + ' — ঠিক করে লিখুন' });
                else {
                    last = { number: pending.number, amount: a.amount, line: pending.line + ' ⏎ ' + body, splits: [], order: pending.order };
                    entries.push(last);
                }
                pending = null;
            }
        } else if (last) {
            const sp = body.match(SPLIT_RE);
            if (sp) last.splits.push(parseFloat(sp[1].replace(/,/g, '')));
        }
    }
    if (pending) loose.push(pending);
    return { entries, errors, loose };
}

/* ভুল নয়, কিন্তু একবার চোখ বুলিয়ে নেওয়া দরকার */
function checkWarnings(block) {
    const warn = [];   // প্রতিটায় order থাকে, যাতে পেস্টের সিরিয়ালেই দেখানো যায়

    block.loose.forEach(l => warn.push({
        order: l.order, line: l.line, reason: `${fmtNum(l.number)} — এই নম্বরের টাকা লেখা নেই`
    }));

    const seen = new Map();
    block.entries.forEach(e => {
        if (e.amount < AMOUNT_MIN_OK) warn.push({
            order: e.order, line: e.line, reason: `${fmtNum(e.number)} = ${bn(e.amount)} — টাকা খুব কম`
        });
        else if (e.amount > AMOUNT_MAX_OK) warn.push({
            order: e.order, line: e.line, reason: `${fmtNum(e.number)} = ${bn(e.amount)} — টাকা খুব বেশি`
        });

        if (e.splits.length) {
            const t = e.splits.reduce((a, c) => a + c, 0);
            if (t !== e.amount) warn.push({
                order: e.order,
                line: e.splits.map(bn).join(' + '),
                reason: `${fmtNum(e.number)} = ${bn(e.amount)} — ভাগের যোগফল ${bn(t)}`
            });
        }

        const first = seen.get(e.number);
        seen.set(e.number, first ? { ...first, count: first.count + 1 } : { order: e.order, count: 1 });
    });

    seen.forEach((v, number) => {
        if (v.count > 1) warn.push({
            order: v.order, line: '', reason: `${fmtNum(number)} — একই নম্বর ${bn(v.count)} বার আছে`
        });
    });

    return warn.sort((a, b) => a.order - b.order);
}

/* বাকি কোড এটাই ব্যবহার করে: এন্ট্রির তালিকা, সাথে .errors ও .warnings */
function parseEntries(text) {
    const block = parseBlock(text);
    const out = block.entries.map(e => ({ number: e.number, amount: e.amount }));
    out.errors = block.errors;
    out.warnings = checkWarnings(block);
    return out;
}

/* ============================================================
   ভুল ও সতর্কতার বাক্স  (লাল = সেভ হবে না, হলুদ = দেখে নিন)
   ============================================================ */
function issueBox(id, after) {
    let box = document.getElementById(id);
    if (!box) {
        box = document.createElement('div');
        box.id = id;
        after.insertAdjacentElement('afterend', box);
    }
    return box;
}

function showEntryErrors(errs) {
    const old = document.getElementById('entryErrors');
    if (!errs || !errs.length) { if (old) old.remove(); return; }

    const box = issueBox('entryErrors', document.getElementById('entryInput'));
    box.style.cssText =
        'margin:8px 0;padding:10px 12px;border:1px solid #e5484d;border-radius:12px;' +
        'background:rgba(229,72,77,.08);color:#b81d38;font-size:13px;line-height:1.5;';
    box.innerHTML =
        `<b>⛔ ${bn(errs.length)} টি ভুল — ঠিক না করলে সেভ হবে না</b>` +
        errs.map(x =>
            `<div style="margin-top:7px"><span dir="ltr" style="word-break:break-all;opacity:.85">${escapeHtml(x.line)}</span>` +
            `<br><b style="font-weight:700">${escapeHtml(x.reason)}</b></div>`
        ).join('');
}

function showEntryWarnings(warns) {
    const old = document.getElementById('entryWarnings');
    if (!warns || !warns.length) { if (old) old.remove(); return; }

    const box = issueBox('entryWarnings', document.getElementById('entryErrors') || document.getElementById('entryInput'));
    box.style.cssText =
        'margin:8px 0;padding:10px 12px;border:1px solid #f3d675;border-left:5px solid #f2b705;' +
        'border-radius:6px 12px 12px 6px;background:#fff8d6;color:#7a5800;font-size:13px;line-height:1.5;';
    box.innerHTML =
        `<b>⚠️ ${bn(warns.length)} টি দেখে নিন</b>` +
        warns.map(x =>
            `<div style="margin-top:7px"><b style="font-weight:700;color:#3f3000">${escapeHtml(x.reason)}</b>` +
            (x.line ? `<br><span dir="ltr" style="word-break:break-all;opacity:.8">${escapeHtml(x.line)}</span>` : '') +
            `</div>`
        ).join('') +
        `<div style="margin-top:9px;font-weight:700">ঠিক থাকলে আবার "সেভ করুন" চাপুন।</div>`;
}

function clearIssues() {
    showEntryErrors([]);
    showEntryWarnings([]);
}

/* ============================================================
   TOAST
   ============================================================ */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, type = '') {
    toastEl.textContent = msg;
    toastEl.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* ============================================================
   CONFIRM
   ============================================================ */
const confirmEl = document.getElementById('confirm');
function askConfirm(msg, cb) {
    document.getElementById('confirmMsg').textContent = msg;
    deleteTarget = cb;
    confirmEl.classList.add('show');
}
document.getElementById('confirmNo').onclick = () => {
    confirmEl.classList.remove('show');
    deleteTarget = null;
};
document.getElementById('confirmYes').onclick = () => {
    confirmEl.classList.remove('show');
    if (deleteTarget) deleteTarget();
    deleteTarget = null;
};

/* ============================================================
   RENDER
   ============================================================ */
function render() {
    const list = document.getElementById('entryList');
    const badge = document.getElementById('countBadge');
    badge.textContent = bn(entries.length);

    if (!entries.length) {
        list.innerHTML = `
            <div class="empty">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                </div>
                <h3>এখনো কোনো এন্ট্রি নেই</h3>
                <p>উপরের + বাটনে ক্লিক করে শুরু করুন</p>
            </div>`;
        return;
    }

    const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = sorted.map(e => renderCard(e, entries.indexOf(e) + 1)).join('');

    if (typeof window.applyCollapsedState === 'function') {
        window.applyCollapsedState();
    }
}

function renderCard(e, no) {
    const noteChip = e.note
        ? `<span class="card-note-chip" title="${escapeHtml(e.note)}">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
               <path d="M12 20h9" />
               <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
             </svg>
             <span class="card-note-text">${escapeHtml(e.note)}</span>
           </span>`
        : '';

    return `
        <article class="card" data-id="${e.id}">
            <div class="card-head">
                <div class="card-meta">
                    <span class="card-no">#${no}</span>
                    ${noteChip}
                </div>
                <div class="card-actions">
                    <span class="card-chevron" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </span>
                    <button class="card-copy" data-copy="${e.id}" type="button" aria-label="হিসাব কপি" title="হিসাব কপি">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                    </button>
                    <button class="card-del" data-del="${e.id}" type="button" aria-label="মুছুন" title="মুছুন">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                        </svg>
                    </button>
                </div>
            </div>

            <div class="card-body">
                <div class="num-list">
                    ${e.entries.map((en, i) => `
                        <div class="num-row">
                            <span class="num-idx">${i + 1}</span>
                            <span class="num" dir="auto">${escapeHtml(fmtNum(en.number))}</span>
                            <span class="amt">৳ ${bn(en.amount)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="card-foot">
                <span class="foot-lbl">
                    <b>${e.entries.length}</b> টি এন্ট্রি
                </span>
                <span class="foot-total">
                    মোট <b>৳ ${bn(e.total)}</b>
                </span>
            </div>
        </article>
    `;
}

/* ============================================================
   SHEET
   ============================================================ */
const sheet = document.getElementById('sheet');
const sheetBg = document.getElementById('sheetBg');

function openSheet() {
    document.getElementById('entryInput').value = '';
    document.getElementById('noteInput').value = '';
    clearIssues();
    disarmSave();
    sheet.classList.add('show');
    sheetBg.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('entryInput').focus(), 350);
}

function closeSheet() {
    sheet.classList.remove('show');
    sheetBg.classList.remove('show');
    document.body.style.overflow = '';
}

document.getElementById('addBtn').onclick = openSheet;
document.getElementById('closeBtn').onclick = closeSheet;
sheetBg.onclick = closeSheet;

document.getElementById('entryInput').addEventListener('input', () => {
    clearIssues();
    disarmSave();
});

document.getElementById('pasteBtn').onclick = async () => {
    try {
        const txt = await navigator.clipboard.readText();
        if (txt) {
            const ta = document.getElementById('entryInput');
            ta.value = ta.value ? ta.value + '\n' + txt : txt;
            clearIssues();
            disarmSave();
            toast('পেস্ট হয়েছে', 'ok');
        }
    } catch {
        toast('ক্লিপবোর্ড অনুমতি নেই', 'err');
    }
};

/* ============================================================
   SAVE
   ------------------------------------------------------------
   লাল ভুল থাকলে সেভ হয় না।
   শুধু সতর্কতা থাকলে একবার দেখায়, দ্বিতীয়বার চাপলে সেভ হয়।
   ============================================================ */
let saveArmed = false;

function setSaveLabel(text) {
    const btn = document.getElementById('saveBtn');
    const node = [...btn.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim());
    if (node) node.textContent = ' ' + text + ' ';
}

function disarmSave() {
    saveArmed = false;
    setSaveLabel('সেভ করুন');
}

document.getElementById('saveBtn').onclick = () => {
    const raw = document.getElementById('entryInput').value.trim();
    const note = document.getElementById('noteInput').value.trim();

    if (!raw) return toast('এন্ট্রি পেস্ট করুন', 'err');

    const parsed = parseEntries(raw);

    /* ১. লাল ভুল — এখানেই থামা */
    if (parsed.errors.length) {
        disarmSave();
        showEntryErrors(parsed.errors);
        showEntryWarnings(parsed.warnings);
        return toast(bn(parsed.errors.length) + ' টি লাইনে ভুল — ঠিক করে আবার সেভ করুন', 'err');
    }
    showEntryErrors([]);

    if (!parsed.length) {
        disarmSave();
        showEntryWarnings(parsed.warnings);
        return toast('বৈধ কোনো এন্ট্রি পাওয়া যায়নি', 'err');
    }

    /* ২. সতর্কতা — প্রথমবার শুধু দেখায় */
    if (parsed.warnings.length && !saveArmed) {
        saveArmed = true;
        setSaveLabel('তবুও সেভ করুন');
        showEntryWarnings(parsed.warnings);
        return toast(bn(parsed.warnings.length) + ' টি সতর্কতা — দেখে নিয়ে আবার সেভ চাপুন', 'err');
    }

    const total = parsed.reduce((s, e) => s + e.amount, 0);

    entries.push({
        id: Date.now() + Math.random().toString(36).slice(2, 7),
        createdAt: Date.now(),
        note,
        entries: parsed.map(p => ({ number: p.number, amount: p.amount })),
        total
    });

    persist();
    render();
    closeSheet();
    disarmSave();
    toast(`সেভ হয়েছে • ${bn(parsed.length)} টি • ৳${bn(total)}`, 'ok');
};

/* ============================================================
   COPY ENTRY
   ============================================================ */
function buildCopyText(entry) {
    const lines = [];
    lines.push(`📅 ${fmtDateTime(entry.createdAt)}`);
    if (entry.note) lines.push(`📝 ${entry.note}`);
    lines.push(`এন্ট্রি: ${entry.entries.length} টি`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    entry.entries.forEach(en => {
        lines.push(`${fmtNum(en.number)} = ${en.amount}`);
    });
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push(`মোট                = ${bn(entry.total)}`);
    return lines.join('\n');
}

async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        return true;
    } catch {
        return false;
    }
}

/* ============================================================
   CLICK HANDLERS
   ============================================================ */
document.addEventListener('click', async ev => {
    const copyBtn = ev.target.closest('[data-copy]');
    if (copyBtn) {
        ev.stopPropagation();
        const id = copyBtn.dataset.copy;
        const entry = entries.find(e => e.id === id);
        if (!entry) return;

        const text = buildCopyText(entry);
        const ok = await copyText(text);

        if (ok) {
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 900);
            toast('কপি হয়েছে', 'ok');
        } else {
            toast('কপি ব্যর্থ', 'err');
        }
        return;
    }

    const del = ev.target.closest('[data-del]');
    if (!del) return;

    const id = del.dataset.del;
    askConfirm('আপনি কি এই এন্ট্রিটি মুছতে চান?', () => {
        entries = entries.filter(e => e.id !== id);
        persist();
        render();
        toast('মুছে ফেলা হয়েছে', 'ok');
    });
});

/* ============================================================
   BOOT
   ============================================================ */
load();
render();

/* ============================================================
   SMOOTH COLLAPSE / EXPAND
   ============================================================ */
(function enableSheetDrag() {
    const handle = document.querySelector('.sheet-handle');
    const sheetEl = document.getElementById('sheet');
    if (!handle || !sheetEl) return;

    let startY = 0;
    let currentY = 0;
    let dragging = false;
    let startTime = 0;

    const start = (y) => {
        startY = currentY = y;
        startTime = Date.now();
        dragging = true;
        sheetEl.classList.add('dragging');
    };

    const move = (y) => {
        if (!dragging) return;
        currentY = y;
        const dy = Math.max(0, y - startY);
        const h = sheetEl.offsetHeight;
        const eased = dy < h * 0.5
            ? dy
            : h * 0.5 + (dy - h * 0.5) * 0.35;
        sheetEl.style.transform = `translate3d(0, ${eased}px, 0)`;
    };

    const end = () => {
        if (!dragging) return;
        dragging = false;
        sheetEl.classList.remove('dragging');
        sheetEl.style.transform = '';

        const dy = currentY - startY;
        const dt = Math.max(1, Date.now() - startTime);
        const velocity = dy / dt;

        if (dy > 120 || velocity > 0.6) closeSheet();
    };

    handle.addEventListener('touchstart', (e) => start(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        move(e.touches[0].clientY);
        if (e.cancelable) e.preventDefault();
    }, { passive: false });
    handle.addEventListener('touchend', end);
    handle.addEventListener('touchcancel', end);

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        start(e.clientY);

        const onMove = (ev) => move(ev.clientY);
        const onUp = () => {
            end();
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    window.addEventListener('blur', () => {
        if (!dragging) return;
        dragging = false;
        sheetEl.classList.remove('dragging');
        sheetEl.style.transform = '';
    });
})();

(function enableCardFold() {
    const STORE = 'raf_hisab_collapsed_v1';

    window.applyCollapsedState = function applyCollapsedState() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { }

        document.querySelectorAll('.card').forEach(card => {
            const id = card.dataset.id;
            if (saved[id]) card.classList.add('collapsed');
        });
    };

    function persistCollapsedState() {
        const state = {};
        document.querySelectorAll('.card').forEach(card => {
            state[card.dataset.id] = card.classList.contains('collapsed');
        });
        try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { }
    }

    document.addEventListener('click', (e) => {
        if (e.target.closest('.card-copy, .card-del')) return;

        const head = e.target.closest('.card-head');
        if (!head) return;

        const card = head.closest('.card');
        if (!card) return;

        card.classList.toggle('collapsed');
        persistCollapsedState();
    });

    applyCollapsedState();
})();

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const s = document.getElementById('sheet');
    if (s && s.classList.contains('show')) closeSheet();
});