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

/* only format real 11-digit phone numbers; leave names untouched */
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
   PARSE  (rules:
     • 11-digit phone  →  first number after it = amount
     • no phone on line →  name + last number = amount
   )
   ============================================================ */

/* Bengali digits → English, and strip invisible chars (LRM, RLM, BOM, ZWSP …) */
function cleanText(s) {
    return fromBn(String(s || ''))
        .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
        .replace(/[\u00A0\u202F]/g, ' ');
}

/* BD mobile: 01[3-9] + 8 digits = 11 digits.
   Tolerates "880"/"+88" prefix and single space / dot / dash between digits
   (e.g. "0 1985-521016").  Any digits glued straight onto the 11 digits
   (typo like 017858528333) are swallowed so they never become the amount. */
const PHONE_RE = /(?<!\d)(?:\+?88[ .\-]?)?(0[ .\-]?1[ .\-]?[3-9](?:[ .\-]?\d){8})(\d*)/g;

/* first positive number in text.
   Accepted grouping separators:   ,   '   ’   ‘   ′
     → 40,000   10'200   1,02,000   1'02'000   10’20’000
   Plain runs still work:          10200   3060
   Decimal (taka.paisa) preserved: 10.50   10'200.50                       */
function extractAmount(str) {
    if (!str) return null;

    // drop "pin:1234" style noise
    const cleaned = str.replace(/\bpin\s*[:#]?\s*\d+/gi, ' ');

    const re = /\d{1,3}(?:[,'’‘′]\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

    let m;
    while ((m = re.exec(cleaned))) {
        const n = Number(m[0].replace(/[,'’‘′]/g, ''));
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}

/* Name + amount line (no phone on it).
   The LAST number on the line is the amount, everything else is the name.
   The name must contain at least one letter, so "500" or "10/13" alone
   never become an entry. */
function splitNameAmount(body) {
    const re = /\d{1,3}(?:[,'’‘′]\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
    let m, last = null;
    while ((m = re.exec(body))) last = m;
    if (!last) return null;

    const amount = Number(last[0].replace(/[,'’‘′]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return null;

    let name = (body.slice(0, last.index) + ' ' + body.slice(last.index + last[0].length))
        .replace(/\s+/g, ' ')
        .replace(/^[\s\-–—:=,،.।|/*]+|[\s\-–—:=,،.।|/*]+$/gu, '')
        .trim();

    if (!name || !/\p{L}/u.test(name)) return null;                       // must have a letter
    if (/^(মোট|সর্বমোট|total|grand\s*total)$/i.test(name)) return null;    // skip totals
    if (name.length > 80) name = name.slice(0, 80).trim();

    return { name, amount };
}

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
            glued: m[2]            // extra digits stuck to the phone (typo)
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

/* digit runs that look like a phone number but are NOT a valid 11-digit one.
   (amounts never have 10+ digits, and never start with 0 and run 8+ digits) */
function findBadNumbers(body, parts) {
    const bad = [];
    const re = /\d+/g;
    let m;
    while ((m = re.exec(body))) {
        const s0 = m.index, e0 = s0 + m[0].length;
        if (parts.some(p => s0 < p.end && e0 > p.start)) continue;   // part of a valid phone
        const len = m[0].length;
        if (len >= 10 || (m[0][0] === '0' && len >= 8)) bad.push({ digits: len });
    }
    /* spaced / dashed number such as "0 1985-52101" with the wrong digit count */
    if (!bad.length && !parts.length && /^(?:\+?88[ .\-]?)?0[ .\-]?1[ .\-]?\d/.test(body)) {
        bad.push({ digits: null });
    }
    return bad;
}

const HEADER_RES = [
    /^\[[^\]]*\]\s*[^:]*:\s*/,                                   // [10/13, 9:37 AM] Name:
    /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?\s*-\s*[^:]*:\s*/ // 10/13/25, 9:37 AM - Name:
];

function parseEntries(text) {
    const out = [];
    const warnings = [];
    const errors = [];
    let pending = null;
    const skipRe = /^(?:<Media omitted>|This message was deleted|You deleted this message)$/i;
    const badReason = n => n
        ? `নম্বর ভুল: ${n} ডিজিট (১১ ডিজিট হতে হবে)`
        : 'নম্বর ভুল: ১১ ডিজিট নয়';

    for (const raw of cleanText(text).split(/\r?\n/)) {
        let body = raw.trim();
        if (!body) continue;

        let isNewMsg = false;
        for (const re of HEADER_RES) {
            if (re.test(body)) { body = body.replace(re, ''); isNewMsg = true; break; }
        }
        body = body.trim();
        if (!body || skipRe.test(body)) { if (isNewMsg) pending = null; continue; }

        const parts = splitByPhone(body);

        /* wrong numbers (too short / too long) */
        const bad = findBadNumbers(body, parts);
        bad.forEach(b => errors.push({ line: body, reason: badReason(b.digits) }));

        if (parts.length) {
            if (pending) {
                warnings.push(`amount missing for ${pending.number}`);
                pending = null;
            }
            for (const p of parts) {
                if (p.glued) {
                    /* 12+ digits glued together → wrong number, do not guess */
                    errors.push({ line: body, reason: badReason(11 + p.glued.length) });
                    pending = null;
                    continue;
                }
                const amount = extractAmount(p.after);
                if (amount != null) out.push({ number: p.number, amount });
                else pending = { number: p.number };
            }
        } else if (bad.length) {
            pending = null;
        } else if (pending) {
            /* continuation line (e.g. "40,000/=" under the phone) */
            const amount = extractAmount(body);
            if (amount != null) {
                out.push({ number: pending.number, amount });
                pending = null;
            } else if (isNewMsg) {
                pending = null;    // a different message with no number: drop it
            }
        } else {
            /* no phone on this line: try "name + amount" */
            const na = splitNameAmount(body);
            if (na) out.push({ number: na.name, amount: na.amount });
        }
    }
    if (pending) warnings.push(`amount missing for ${pending.number}`);
    out.warnings = warnings;
    out.errors = errors;
    return out;
}

/* ============================================================
   WRONG-NUMBER BOX  (shown under the text area)
   ============================================================ */
function showEntryErrors(errs) {
    let box = document.getElementById('entryErrors');
    if (!errs || !errs.length) {
        if (box) box.remove();
        return;
    }
    if (!box) {
        box = document.createElement('div');
        box.id = 'entryErrors';
        document.getElementById('entryInput').insertAdjacentElement('afterend', box);
    }
    box.style.cssText =
        'margin:8px 0;padding:10px;border:1px solid #e5484d;border-radius:10px;' +
        'background:rgba(229,72,77,.08);color:#e5484d;font-size:13px;line-height:1.5;';
    box.innerHTML =
        `<b>⚠ ${errs.length} টি ভুল এন্ট্রি</b>` +
        errs.map(x =>
            `<div style="margin-top:6px"><span dir="ltr" style="word-break:break-all">${escapeHtml(x.line)}</span>` +
            `<br><small>${x.reason}</small></div>`
        ).join('');
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

    // newest first
    const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = sorted.map(e => renderCard(e, entries.indexOf(e) + 1)).join('');

    // reapply fold state after re-render
    if (typeof window.applyCollapsedState === 'function') {
        window.applyCollapsedState();
    }
}

function renderCard(e, no) {
    /* compact note chip shown in the header */
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
    showEntryErrors([]);
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

/* clear the red box as soon as the text is edited */
document.getElementById('entryInput').addEventListener('input', () => showEntryErrors([]));

/* Paste button */
document.getElementById('pasteBtn').onclick = async () => {
    try {
        const txt = await navigator.clipboard.readText();
        if (txt) {
            const ta = document.getElementById('entryInput');
            ta.value = ta.value ? ta.value + '\n' + txt : txt;
            showEntryErrors([]);
            toast('পেস্ট হয়েছে', 'ok');
        }
    } catch {
        toast('ক্লিপবোর্ড অনুমতি নেই', 'err');
    }
};

/* ============================================================
   SAVE
   ============================================================ */
document.getElementById('saveBtn').onclick = () => {
    const raw = document.getElementById('entryInput').value.trim();
    const note = document.getElementById('noteInput').value.trim();

    if (!raw) return toast('এন্ট্রি পেস্ট করুন', 'err');

    const parsed = parseEntries(raw);

    /* wrong number (not 11 digits) → show it and do NOT save */
    if (parsed.errors && parsed.errors.length) {
        showEntryErrors(parsed.errors);
        return toast(parsed.errors.length + ' টি নম্বর ভুল — ঠিক করে আবার সেভ করুন', 'err');
    }
    showEntryErrors([]);

    if (!parsed.length) return toast('বৈধ কোনো এন্ট্রি পাওয়া যায়নি', 'err');

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
    toast(`সেভ হয়েছে • ${parsed.length} টি • ৳${bn(total)}`, 'ok');
};

/* ============================================================
   COPY ENTRY  (note + numbers + total)
   ============================================================ */
function buildCopyText(entry) {
    const lines = [];

    lines.push(`📅 ${fmtDateTime(entry.createdAt)}`);

    if (entry.note) {
        lines.push(`📝 ${entry.note}`);
    }
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
            // fallback for older browsers / non-https
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
   CLICK HANDLERS (copy + delete) — delegated
   ============================================================ */
document.addEventListener('click', async ev => {
    /* ---------- copy ---------- */
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

    /* ---------- delete ---------- */
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
   ------------------------------------------------------------
   • drag the sheet handle down to dismiss
   • click a card head to fold / unfold its body
   • fold state is remembered per entry
   ============================================================ */

/* ---------- 1. DRAG-TO-CLOSE the bottom sheet ---------- */
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

        // rubber-band: past 50% of height, dampen heavily
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
        const velocity = dy / dt; // px per ms

        // dismiss if dragged far enough, or fast-flicked down
        if (dy > 120 || velocity > 0.6) closeSheet();
    };

    /* --- touch --- */
    handle.addEventListener('touchstart', (e) => {
        start(e.touches[0].clientY);
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        move(e.touches[0].clientY);
        if (e.cancelable) e.preventDefault();   // stop page scroll
    }, { passive: false });

    handle.addEventListener('touchend', end);
    handle.addEventListener('touchcancel', end);

    /* --- mouse --- */
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

    /* --- safety: reset transform if a drag is somehow interrupted --- */
    window.addEventListener('blur', () => {
        if (!dragging) return;
        dragging = false;
        sheetEl.classList.remove('dragging');
        sheetEl.style.transform = '';
    });
})();

/* ---------- 2. CARD FOLD: click the head to collapse ---------- */
(function enableCardFold() {
    const STORE = 'raf_hisab_collapsed_v1';

    // read saved state
    window.applyCollapsedState = function applyCollapsedState() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { }

        document.querySelectorAll('.card').forEach(card => {
            const id = card.dataset.id;
            if (saved[id]) card.classList.add('collapsed');
        });
    };

    // persist current state
    function persistCollapsedState() {
        const state = {};
        document.querySelectorAll('.card').forEach(card => {
            state[card.dataset.id] = card.classList.contains('collapsed');
        });
        try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { }
    }

    // delegated click — toggle fold, unless the user hit copy/delete
    document.addEventListener('click', (e) => {
        if (e.target.closest('.card-copy, .card-del')) return;

        const head = e.target.closest('.card-head');
        if (!head) return;

        const card = head.closest('.card');
        if (!card) return;

        card.classList.toggle('collapsed');
        persistCollapsedState();
    });

    // run once on boot in case anything is already rendered
    applyCollapsedState();
})();

/* ---------- 3. ESC closes the sheet ---------- */
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const s = document.getElementById('sheet');
    if (s && s.classList.contains('show')) closeSheet();
});