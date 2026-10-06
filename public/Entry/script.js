/* ============================================================
   API CONFIG
   ============================================================ */
const API_BASE = '';   // 👈 change to your backend
const API_TOKEN = '';                           // 👈 optional

async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch { }
        throw new Error(msg);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

/* ============================================================
   STATE
   ============================================================ */
let records = [];
const openDays = new Set();
let confirmCb = null;
let lastTotals = { amount: 0, numbers: 0, days: 0 };

/* ============================================================
   BACKEND CRUD
   ============================================================ */
async function fetchRecords() {
    try {
        const data = await api('/entries', { method: 'GET' });
        records = Array.isArray(data) ? data : (data?.data || []);
    } catch (err) {
        records = [];
        toast('ডেটা লোড ব্যর্থ: ' + err.message, 'err');
        console.error(err);
    }
}

async function createRecord(payload) {
    const created = await api('/entries', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    const record = created?.data || created;
    records.push(record);
    return record;
}

async function removeByDate(date) {
    await api(`/entries/by-date/${encodeURIComponent(date)}`, { method: 'DELETE' });
    records = records.filter(r => r.date !== date);
    openDays.delete(date);
}

/* ============================================================
   BANGLA HELPERS
   ============================================================ */
const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const toBn = s => String(s).replace(/\d/g, d => BN[+d]);
const bn = n => toBn(Number(n).toLocaleString('en-US'));
const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const monthName = ym => MONTHS[+ym.split('-')[1] - 1];
const monthShort = ym => monthName(ym).slice(0, 4);
const WEEKDAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const weekday = d => {
    const [y, m, dd] = d.split('-').map(Number);
    return WEEKDAYS[new Date(y, m - 1, dd).getDay()];
};
const fmtNum = n => n.length === 11 ? n.slice(0, 5) + '-' + n.slice(5) : n;

/* ============================================================
   TOAST
   ============================================================ */
const toastEl = document.getElementById('toast');
const toastIcon = document.getElementById('toastIcon');
const toastMsg = document.getElementById('toastMsg');
let tT;

function toast(msg, type = '') {
    toastMsg.textContent = msg;
    toastEl.className = 'toast show ' + type;
    if (type === 'ok') { toastIcon.textContent = '✓'; toastIcon.style.display = 'grid'; }
    else if (type === 'err') { toastIcon.textContent = '!'; toastIcon.style.display = 'grid'; }
    else { toastIcon.style.display = 'none'; }
    clearTimeout(tT);
    tT = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

/* ============================================================
   CONFIRM
   ============================================================ */
const confirmEl = document.getElementById('confirm');
function askConfirm(title, msg, cb) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    confirmCb = cb;
    confirmEl.classList.add('show');
}
document.getElementById('confirmNo').onclick = () => {
    confirmEl.classList.remove('show');
    confirmCb = null;
};
document.getElementById('confirmYes').onclick = async () => {
    confirmEl.classList.remove('show');
    if (confirmCb) await confirmCb();
    confirmCb = null;
};

/* ============================================================
   PARSE
   ============================================================ */
/* ============================================================
   PARSE — WhatsApp export + plain text
   শুধু নম্বর ও টাকা বের করে। তারিখ বাদ।
   ============================================================ */

/* ---- phone normalization ---- */
function normalizePhone(raw) {
    let d = raw.replace(/\D/g, '');

    if (d.startsWith('00')) d = d.slice(2);        // 00880… → 880…
    if (d.startsWith('880')) d = d.slice(3);       // 8801…  → 1…
    else if (d.startsWith('88')) d = d.slice(2);   // 881…   → 1…

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

/* ---- find phone + position in a line ---- */
function extractPhone(line) {
    // Constrained pattern: doesn't swallow the amount that follows
    const re = /(?:(?:\+|00)?88[\s\-]?)?0[\s\-]?1[\s\-]?\d{3}[\s\-]?\d{6}/;
    const m = line.match(re);
    if (!m) return null;

    const number = normalizePhone(m[0]);
    if (!number) return null;

    return { number, index: m.index, length: m[0].length };
}

/* ---- extract first amount from text (skips Pin1234) ---- */
function extractAmount(str) {
    if (!str) return null;
    const cleaned = str.replace(/\bpin\s*[:#]?\s*\d+/gi, ' ');
    const m = cleaned.match(/\d+(?:,\d{3})*/);
    if (!m) return null;
    const n = Number(m[0].replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---- main parser ---- */
function parseEntries(text) {
    const out = [];
    const lines = String(text || '').split(/\r?\n/);
    let pending = null; // { number } — waiting for amount on next line

    const skipRe = /^(?:<Media omitted>|This message was deleted|You deleted this message|Hi|Ok|Ol|)$/i;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        let body = line;

        // Strip WhatsApp prefix — two common styles
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
        if (skipRe.test(body)) continue;

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
   SHEET
   ============================================================ */
const sheet = document.getElementById('sheet');
const sheetBg = document.getElementById('sheetBg');

function openSheet() {
    document.getElementById('date').value = todayStr();
    sheet.classList.add('show');
    sheetBg.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('input').focus(), 380);
}
function closeSheet() {
    sheet.classList.remove('show');
    sheetBg.classList.remove('show');
    document.body.style.overflow = '';
}
document.getElementById('addTop').onclick = openSheet;
sheetBg.onclick = closeSheet;

/* ============================================================
   PASTE
   ============================================================ */
document.getElementById('pasteBtn').onclick = async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            document.getElementById('input').value = text;
            toast('পেস্ট হয়েছে', 'ok');
        }
    } catch { toast('অনুমতি দেওয়া হয়নি', 'err'); }
};

/* ============================================================
   PREVIEW
   ============================================================ */
const previewBox = document.getElementById('previewBox');
document.getElementById('previewBtn').onclick = () => {
    const entries = parseEntries(document.getElementById('input').value);
    if (!entries.length) {
        previewBox.classList.remove('show');
        toast('কোনো বৈধ এন্ট্রি পাওয়া যায়নি', 'err');
        return;
    }
    const total = entries.reduce((s, e) => s + e.amount, 0);
    const uniq = new Set(entries.map(e => e.number)).size;
    previewBox.innerHTML = `
        <div class="preview-summary">
            <div class="preview-chip"><div class="n">${toBn(entries.length)}</div><div class="l">এন্ট্রি</div></div>
            <div class="preview-chip"><div class="n">${toBn(uniq)}</div><div class="l">ইউনিক</div></div>
            <div class="preview-chip"><div class="n">৳${bn(total)}</div><div class="l">মোট</div></div>
        </div>
        <div class="preview-list">
            ${entries.map(e => `
                <div class="preview-row">
                    <span class="num">${toBn(fmtNum(e.number))}</span>
                    <span class="amt">৳ ${bn(e.amount)}</span>
                </div>`).join('')}
        </div>`;
    previewBox.classList.add('show');
};

/* ============================================================
   SAVE  → POST to backend
   ============================================================ */
document.getElementById('saveBtn').onclick = async () => {
    const date = document.getElementById('date').value;
    const raw = document.getElementById('input').value.trim();
    if (!date) return toast('তারিখ নির্বাচন করুন', 'err');

    const entries = parseEntries(raw);
    if (!entries.length) return toast('বৈধ এন্ট্রি পাওয়া যায়নি', 'err');

    const total = entries.reduce((s, e) => s + e.amount, 0);

    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;

    try {
        await createRecord({
            date, raw, entries, total,
            count: entries.length
        });

        document.getElementById('input').value = '';
        previewBox.classList.remove('show');
        closeSheet();
        openDays.add(date);

        toast(`সেভ হয়েছে • ${toBn(entries.length)} এন্ট্রি • ৳${bn(total)}`, 'ok');

        const ym = date.slice(0, 7);
        if (currentRoute === `month/${ym}`) renderMonthView(ym);
        else navigateTo(`month/${ym}`);
    } catch (err) {
        toast('সেভ ব্যর্থ: ' + err.message, 'err');
    } finally {
        saveBtn.disabled = false;
    }
};

/* ============================================================
   ICONS
   ============================================================ */
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const ARROW_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
const PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

/* ============================================================
   GROUP  (unchanged — works on the fetched records array)
   ============================================================ */
function groupData() {
    const months = {};
    [...records]
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        .forEach(r => {
            const ym = r.date.slice(0, 7);
            const m = months[ym] || (months[ym] = { total: 0, count: 0, days: {} });
            const d = m.days[r.date] || (m.days[r.date] = { total: 0, count: 0, entries: [] });
            m.total += r.total;
            m.count += r.count;
            d.total += r.total;
            d.count += r.count;
            d.entries.push(...r.entries);
        });
    return months;
}

/* ============================================================
   ROUTER
   ============================================================ */
let currentRoute = '';

function navigateTo(route) {
    const hash = route ? '#/' + route : '#/';
    if (location.hash === hash) { handleRoute(); return; }
    location.hash = hash;
}

async function handleRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    currentRoute = hash;

    const viewHome = document.getElementById('viewHome');
    const viewMonth = document.getElementById('viewMonth');

    if (hash.startsWith('month/')) {
        const ym = hash.slice(6);
        if (!/^\d{4}-\d{2}$/.test(ym)) { navigateTo(''); return; }
        viewHome.hidden = true;
        viewMonth.hidden = false;
        document.body.classList.add('in-month');
        document.getElementById('topTitle').textContent = monthName(ym) + ' ' + toBn(ym.slice(0, 4));
        document.getElementById('topSub').textContent = 'মাসের বিস্তারিত';
        renderMonthView(ym);
        window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
        viewHome.hidden = false;
        viewMonth.hidden = true;
        document.body.classList.remove('in-month');
        document.getElementById('topTitle').textContent = 'এন্ট্রি ম্যানেজার';
        document.getElementById('topSub').textContent = 'দৈনিক হিসাব • মাসিক রিপোর্ট';
        renderHome();
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}
window.addEventListener('hashchange', handleRoute);

/* ============================================================
   HOME VIEW
   ============================================================ */
function renderHome() {
    renderMonthList();
}

function renderMonthList() {
    const months = groupData();
    const keys = Object.keys(months).sort().reverse();
    const el = document.getElementById('monthList');
    document.getElementById('monthCount').textContent = toBn(keys.length) + ' মাস';

    if (!keys.length) {
        el.innerHTML = `
            <div class="empty">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <h3>এখনো কোনো এন্ট্রি নেই</h3>
                <p>নিচের + বাটনে ক্লিক করে শুরু করুন</p>
            </div>`;
        return;
    }

    el.innerHTML = keys.map(ym => {
        const m = months[ym];
        const dates = Object.keys(m.days).length;
        return `
            <article class="month-card">
                <button class="month-btn" data-open-month="${ym}" type="button">
                  
                    <div class="month-info">
                        <div class="month-name">${monthName(ym)} ${toBn(ym.slice(0, 4))}</div>
                        <div class="month-meta">
                            <span>${toBn(dates)} দিন</span>
                            <span class="meta-dot"></span>
                            <span>${toBn(m.count)} টি নম্বর</span>
                        </div>
                    </div>
                    <div class="month-total">
                        <div class="amt">৳ ${bn(m.total)}</div>
                        <div class="cnt">মোট</div>
                    </div>
                    <span class="month-arrow">${ARROW_RIGHT}</span>
                </button>
            </article>`;
    }).join('');
}

/* ============================================================
   MONTH VIEW
   ============================================================ */
function renderMonthView(ym) {
    const months = groupData();
    const m = months[ym];

    const mh = document.getElementById('monthHero');
    const dayListEl = document.getElementById('dayList');
    const dayCountEl = document.getElementById('dayCount');

    if (!m) {
        mh.style.display = 'none';
        dayListEl.innerHTML = `<div class="empty">
            <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
            <h3>এই মাসে কোনো এন্ট্রি নেই</h3>
            <p>+ বাটনে ক্লিক করে এন্ট্রি যোগ করুন</p>
        </div>`;
        dayCountEl.textContent = '০ দিন';
        return;
    }

    mh.style.display = '';
    document.getElementById('mhBadge').textContent = monthShort(ym);
    document.getElementById('mhTitle').textContent = monthName(ym) + ' ' + toBn(ym.slice(0, 4));
    const dates = Object.keys(m.days).sort().reverse();
    document.getElementById('mhSub').textContent = `${toBn(dates.length)} দিন • ${toBn(m.count)} টি নম্বর`;
    document.getElementById('mhTotal').textContent = '৳ ' + bn(m.total);
    dayCountEl.textContent = toBn(dates.length) + ' দিন';

    dayListEl.innerHTML = dates.map(date => renderDayCard(date, m.days[date])).join('');
}

function renderDayCard(date, d) {
    const isOpen = openDays.has(date);
    return `
        <div class="day-card ${isOpen ? 'is-open' : ''}" data-day="${date}">
            <button class="day-head" data-td="${date}" type="button">
                <div class="day-chip">
                    <b>${toBn(+date.slice(8))}</b>
                   
                </div>
                <div class="day-info">
                    <div class="d1">${weekday(date)}</div>
                    <div class="d2">${toBn(d.count)} টি নম্বর</div>
                </div>
                <div class="day-amt">৳ ${bn(d.total)}</div>
                <span class="chev">${CHEV}</span>
            </button>
            <div class="collapse">
                <div class="collapse-in">
                    <div class="day-body">
                        <div class="entry-list">
                            ${d.entries.map(e => `
                                <button class="entry-line" data-copy="${e.number}" type="button">
                                    <span class="entry-ico">${PHONE}</span>
                                    <span class="n">${toBn(fmtNum(e.number))}</span>
                                    <span class="a">৳ ${bn(e.amount)}</span>
                                </button>`).join('')}
                        </div>
                        <button class="day-delete" data-del="${date}" type="button">
                            ${TRASH}
                            এই দিনের এন্ট্রি মুছুন
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
}

/* ============================================================
   DELEGATED CLICKS
   ============================================================ */
document.addEventListener('click', async ev => {
    const openMonthBtn = ev.target.closest('[data-open-month]');
    if (openMonthBtn) {
        navigateTo('month/' + openMonthBtn.dataset.openMonth);
        return;
    }

    const td = ev.target.closest('[data-td]');
    const cp = ev.target.closest('[data-copy]');
    const del = ev.target.closest('[data-del]');

    if (del) {
        ev.stopPropagation();
        const date = del.dataset.del;
        askConfirm('এন্ট্রি মুছবেন?', 'এই দিনের সব এন্ট্রি মুছে যাবে। এটি ফেরানো যাবে না।', async () => {
            try {
                await removeByDate(date);
                const ym = date.slice(0, 7);
                renderMonthView(ym);
                toast('মুছে ফেলা হয়েছে', 'ok');
            } catch (err) {
                toast('মুছা ব্যর্থ: ' + err.message, 'err');
            }
        });
    } else if (cp) {
        const num = cp.dataset.copy;
        cp.classList.add('copied');
        setTimeout(() => cp.classList.remove('copied'), 900);
        (navigator.clipboard ? navigator.clipboard.writeText(num) : Promise.reject())
            .then(() => toast('নম্বর কপি হয়েছে', 'ok'),
                () => toast(toBn(fmtNum(num))));
    } else if (td) {
        const card = td.closest('.day-card');
        card.classList.toggle('is-open');
        card.classList.contains('is-open')
            ? openDays.add(td.dataset.td)
            : openDays.delete(td.dataset.td);
    }
});

/* ============================================================
   BACK BUTTON
   ============================================================ */
document.getElementById('backBtn').onclick = () => {
    if (location.hash && location.hash !== '#/') navigateTo('');
    else history.back();
};

/* ============================================================
   TOPBAR SHADOW
   ============================================================ */
const topbar = document.getElementById('topbar');
window.addEventListener('scroll', () => {
    topbar.classList.toggle('scrolled', window.scrollY > 8);
}, { passive: true });

/* ============================================================
   DATE
   ============================================================ */
function todayStr(d = new Date()) {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/* ============================================================
   BOOT  — fetch from backend, then render
   ============================================================ */
(async function init() {
    await fetchRecords();
    handleRoute();
})();