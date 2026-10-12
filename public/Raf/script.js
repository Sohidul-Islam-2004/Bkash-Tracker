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

const fmtNum = n => n && n.length === 11 ? n.slice(0, 5) + '-' + n.slice(5) : n;

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
   PARSE ENTRY TEXT
   ============================================================ */
function normalizePhone(raw) {
    let d = raw.replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('880')) d = d.slice(3);
    else if (d.startsWith('88')) d = d.slice(2);
    if (!d.startsWith('0')) d = '0' + d;
    if (d.length === 11 && d.startsWith('01')) return d;
    if (d.length > 11) {
        for (let i = 0; i + 11 <= d.length; i++) {
            const sub = d.slice(i, i + 11);
            if (sub.startsWith('01')) return sub;
        }
    }
    return null;
}

function extractPhone(line) {
    const re = /(?:(?:\+|00)?88[\s\-]?)?0[\s\-]?1[\s\-]?\d{3}[\s\-]?\d{6}/;
    const m = line.match(re);
    if (!m) return null;
    const number = normalizePhone(m[0]);
    if (!number) return null;
    return { number, index: m.index, length: m[0].length };
}

function extractAmount(str) {
    if (!str) return null;
    const cleaned = str.replace(/\bpin\s*[:#]?\s*\d+/gi, ' ');
    const m = cleaned.match(/\d+(?:,\d{3})*/);
    if (!m) return null;
    const n = Number(m[0].replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseEntries(text) {
    const out = [];
    const lines = fromBn(String(text || '')).split(/\r?\n/);
    let pending = null;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        let body = line;
        // WhatsApp style: "12/01/2026, 10:30 AM - Name: message"
        let m = line.match(
            /^\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*-\s*[^:]+:\s*([\s\S]*)$/i
        );
        if (m) body = m[1];
        else {
            m = line.match(
                /^\[\d{1,2}\/\d{1,2},\s*\d{1,2}:\d{2}\s*(?:AM|PM)\]\s*[^:]+:\s*([\s\S]*)$/i
            );
            if (m) body = m[1];
        }
        body = body.trim();
        if (!body) continue;

        const phone = extractPhone(body);
        if (phone) {
            const after = body.slice(phone.index + phone.length);
            const amount = extractAmount(after);
            if (amount != null) {
                out.push({ number: phone.number, amount });
                pending = null;
            } else {
                pending = { number: phone.number };
            }
        } else if (pending) {
            const amount = extractAmount(body);
            if (amount != null) {
                out.push({ number: pending.number, amount });
                pending = null;
            }
        }
    }
    return out;
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
}

function renderCard(e, no) {
    const noteBlock = e.note
        ? `<div class="card-note">
             <span class="note-label">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M12 20h9" />
                 <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
               </svg>
               নোট
             </span>
             <span class="note-text">${escapeHtml(e.note)}</span>
           </div>`
        : '';

    return `
        <article class="card" data-id="${e.id}">
            <div class="card-head">
                <div class="card-meta">
                <span class="card-no">#${no}</span>
                <div class="card-date">
                    <span class="date-ico">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="9" />
                            <polyline points="12 7 12 12 15 14" />
                        </svg>
                    </span>
                    ${fmtDateTime(e.createdAt)}
                </div>
                </div>
                <div class="card-actions">
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

            ${noteBlock}

            <div class="num-list">
                ${e.entries.map((en, i) => `
                    <div class="num-row">
                        <span class="num-idx">${i + 1}</span>
                        <span class="num">${fmtNum(en.number)}</span>
                        <span class="amt">৳ ${bn(en.amount)}</span>
                    </div>
                `).join('')}
            </div>

            <div class="card-foot">
                <span class="foot-lbl">
                    <b>${e.entries.length}</b> টি নম্বর
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

/* Paste button */
document.getElementById('pasteBtn').onclick = async () => {
    try {
        const txt = await navigator.clipboard.readText();
        if (txt) {
            const ta = document.getElementById('entryInput');
            ta.value = ta.value ? ta.value + '\n' + txt : txt;
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
    if (!parsed.length) return toast('বৈধ কোনো এন্ট্রি পাওয়া যায়নি', 'err');

    const total = parsed.reduce((s, e) => s + e.amount, 0);

    entries.push({
        id: Date.now() + Math.random().toString(36).slice(2, 7),
        createdAt: Date.now(),
        note,
        entries: parsed,
        total
    });

    persist();
    render();
    closeSheet();
    toast(`সেভ হয়েছে • ${parsed.length} টি নম্বর • ৳${bn(total)}`, 'ok');
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
    lines.push(`নম্বর: ${entry.entries.length} টি`);
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