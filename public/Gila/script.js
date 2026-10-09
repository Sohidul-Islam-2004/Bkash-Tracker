/* ============================================================
   API CONFIG
   ============================================================ */
const API_BASE = '';
const API_TOKEN = '';
const InitialCarry = 648990;

async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
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
let currentRoute = '';

/* ---------- PERSON STATE ---------- */
const LS_PERSONS = 'elm_persons_v1';
const LS_PENTRIES = 'elm_person_entries_v1';
const LS_HOME_TAB = 'elm_home_tab_v1';

let persons = [];
let personEntries = [];
let homeTab = 'bkash';           // 'bkash' | 'person'
let editingPersonId = null;      // null = add new
let editingPdayPersonId = null;  // person id in pday sheet
let editingPdayDate = null;

/* ============================================================
   BACKEND CRUD  (bKash)
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

async function updateDeposit(date, deposit) {
    const val = Number(deposit) || 0;
    const updated = await api(`/entries/by-date/${encodeURIComponent(date)}`, {
        method: 'PATCH',
        body: JSON.stringify({ deposit: val })
    });
    const rec = records.find(r => r.date === date);
    if (rec) rec.deposit = val;
    else if (updated && (updated.date || updated.data)) records.push(updated.data || updated);
}

async function removeByDate(date) {
    await api(`/entries/by-date/${encodeURIComponent(date)}`, { method: 'DELETE' });
    records = records.filter(r => r.date !== date);
    openDays.delete(date);
}

/* ============================================================
   NUMERAL HELPERS
   ============================================================ */
const toBn = s => String(s);
const bn = n => Number(n || 0).toLocaleString('en-US');

const BN_TO_EN = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
const fromBn = s => String(s).replace(/[০-৯]/g, d => BN_TO_EN[d] || d);
function parseNum(str) {
    const cleaned = fromBn(str).replace(/[^\d.\-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
}

const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const monthName = ym => MONTHS[+ym.split('-')[1] - 1];
const WEEKDAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const weekday = d => {
    const [y, m, dd] = d.split('-').map(Number);
    return WEEKDAYS[new Date(y, m - 1, dd).getDay()];
};
const fmtNum = n => n.length === 11 ? n.slice(0, 5) + '-' + n.slice(5) : n;
const fmtDate = iso => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};

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
   PARSE  (bKash)
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
    const lines = String(text || '').split(/\r?\n/);
    let pending = null;
    const skipRe = /^(?:<Media omitted>|This message was deleted|You deleted this message|Hi|Ok|Ol|)$/i;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        let body = line;
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
   BKASH SHEET
   ============================================================ */
const sheet = document.getElementById('sheet');
const sheetBg = document.getElementById('sheetBg');

function showSheetBg() { sheetBg.classList.add('show'); document.body.style.overflow = 'hidden'; }
function hideSheetBg() { sheetBg.classList.remove('show'); document.body.style.overflow = ''; }

function openSheet() {
    const today = todayStr();
    document.getElementById('date').value = today;
    document.getElementById('input').value = '';
    document.getElementById('joma').value = '';
    updateSheetEjaaHint(today);
    sheet.classList.add('show');
    showSheetBg();
    setTimeout(() => document.getElementById('input').focus(), 380);
}
function closeSheet() {
    sheet.classList.remove('show');
    hideSheetBg();
}
sheetBg.onclick = () => {
    closeSheet();
    closePersonSheet();
    closePdaySheet();
};

document.getElementById('date').addEventListener('change', ev => {
    updateSheetEjaaHint(ev.target.value);
});

function updateSheetEjaaHint(date) {
    const hint = document.getElementById('ejaaHint');
    if (!hint) return;
    if (!date) {
        hint.textContent = 'ইজা স্বয়ংক্রিয়ভাবে আগের দিনের হাসান পাওনা থেকে আসবে';
        return;
    }
    const all = computeAllDays();
    const ejaa = all[date] ? all[date].ejaa : 0;
    hint.textContent = `এই দিনের ইজা (আগের দিনের পাওনা): ৳ ${bn(ejaa)}`;
}

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
    const reversed = [...entries].reverse();
    previewBox.innerHTML = `
        <div class="preview-summary">
            <div class="preview-chip"><div class="n">${entries.length}</div><div class="l">এন্ট্রি</div></div>
            <div class="preview-chip"><div class="n">${uniq}</div><div class="l">ইউনিক</div></div>
            <div class="preview-chip"><div class="n">৳${bn(total)}</div><div class="l">মোট</div></div>
        </div>
        <div class="preview-list">
            ${reversed.map(e => `
                <div class="preview-row">
                    <span class="num">${fmtNum(e.number)}</span>
                    <span class="amt">৳ ${bn(e.amount)}</span>
                </div>`).join('')}
        </div>`;
    previewBox.classList.add('show');
};

/* ============================================================
   SAVE  (bKash)
   ============================================================ */
document.getElementById('saveBtn').onclick = async () => {
    const date = document.getElementById('date').value;
    const raw = document.getElementById('input').value.trim();
    const depositVal = parseNum(document.getElementById('joma').value);
    if (!date) return toast('তারিখ নির্বাচন করুন', 'err');

    const entries = parseEntries(raw);
    if (!entries.length) return toast('বৈধ এন্ট্রি পাওয়া যায়নি', 'err');

    const total = entries.reduce((s, e) => s + e.amount, 0);
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;

    try {
        await createRecord({ date, raw, entries, total, count: entries.length, deposit: depositVal });
        document.getElementById('input').value = '';
        document.getElementById('joma').value = '';
        previewBox.classList.remove('show');
        closeSheet();
        openDays.add(date);

        const ym = date.slice(0, 7);
        const wasOnSameMonth = currentRoute === `month/${ym}`;
        const wasOnSameDay = currentRoute === `day/${date}`;

        toast(`সেভ হয়েছে • ${entries.length} এন্ট্রি • জমা ৳${bn(depositVal)}`, 'ok');

        if (wasOnSameDay) renderDayView(date);
        else if (wasOnSameMonth) renderMonthView(ym);
        else navigateTo(`day/${date}`);
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
const COIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h6M9 14h6"/></svg>';
const COPY_ALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const PERSON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

/* ============================================================
   GROUP DATA  (bKash)
   ============================================================ */
function groupData() {
    const months = {};
    [...records]
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') ||
            (a.createdAt || '').localeCompare(b.createdAt || ''))
        .forEach(r => {
            const ym = r.date.slice(0, 7);
            const m = months[ym] || (months[ym] = { total: 0, count: 0, days: {} });
            const d = m.days[r.date] || (m.days[r.date] = { total: 0, count: 0, entries: [], deposit: 0 });
            m.total += r.total;
            m.count += r.count;
            d.total += r.total;
            d.count += r.count;
            d.entries.push(...r.entries);
            if (r.deposit) d.deposit = Number(r.deposit) || 0;
        });
    return months;
}

/* ============================================================
   COMPUTE ALL DAYS  (bKash carry)
   ============================================================ */
function computeAllDays() {
    const allDates = [...new Set(records.map(r => r.date))].sort();
    const months = groupData();
    const result = {};
    let carry = InitialCarry;

    for (const date of allDates) {
        const ym = date.slice(0, 7);
        const d = months[ym] && months[ym].days[date];
        if (!d) continue;

        const deposit = d.deposit || 0;
        const bkash = d.total;
        const ejaa = carry;
        const total = bkash + ejaa;
        const pawna = total - deposit;

        result[date] = { bkash, ejaa, deposit, total, pawna };
        carry = pawna;
    }
    return result;
}

function computeDay(date, d) {
    const all = computeAllDays();
    return all[date] || { bkash: d.total, ejaa: 0, deposit: d.deposit || 0, total: d.total, pawna: d.total };
}

function monthBkashTotal(ym, monthsInput) {
    const months = monthsInput || groupData();
    const m = months[ym];
    if (!m) return 0;
    const all = computeAllDays();
    let sum = 0;
    for (const date in m.days) sum += all[date] ? all[date].bkash : m.days[date].total;
    return sum;
}
function monthDepositTotal(ym, monthsInput) {
    const months = monthsInput || groupData();
    const m = months[ym];
    if (!m) return 0;
    let sum = 0;
    for (const date in m.days) sum += (m.days[date].deposit || 0);
    return sum;
}
function monthFinalPawna(ym, monthsInput) {
    const months = monthsInput || groupData();
    const m = months[ym];
    if (!m) return 0;
    const all = computeAllDays();
    const dates = Object.keys(m.days).sort();
    const last = dates[dates.length - 1];
    return all[last] ? all[last].pawna : 0;
}
function overallPawna() {
    const all = computeAllDays();
    const dates = Object.keys(all).sort();
    if (!dates.length) return InitialCarry;
    return all[dates[dates.length - 1]].pawna;
}
const monthTotal = monthBkashTotal;

function pawnaState(pawna) {
    if (pawna > 0) return 'due';
    if (pawna < 0) return 'advance';
    return 'settled';
}

/* ============================================================
   PERSON MODULE  —  storage + CRUD
   ============================================================ */
function loadPersonData() {
    try {
        persons = JSON.parse(localStorage.getItem(LS_PERSONS) || '[]') || [];
        personEntries = JSON.parse(localStorage.getItem(LS_PENTRIES) || '[]') || [];
    } catch {
        persons = [];
        personEntries = [];
    }
    homeTab = localStorage.getItem(LS_HOME_TAB) || 'bkash';
}
function persistPersons() { localStorage.setItem(LS_PERSONS, JSON.stringify(persons)); }
function persistPersonEntries() { localStorage.setItem(LS_PENTRIES, JSON.stringify(personEntries)); }

function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getPerson(id) { return persons.find(p => p.id === id); }
function personEntriesFor(pid) { return personEntries.filter(e => e.personId === pid); }

function personTotalPieces(pid) {
    return personEntriesFor(pid).reduce((s, e) => s + (Number(e.pieces) || 0), 0);
}
function personTotalEarned(pid) {
    const p = getPerson(pid);
    if (!p) return 0;
    return personTotalPieces(pid) * (Number(p.price) || 0);
}
function personDue(pid) {
    const p = getPerson(pid);
    if (!p) return 0;
    return (Number(p.advance) || 0) - personTotalEarned(pid);
}

/* Returns { "YYYY-MM": { days: { "YYYY-MM-DD": {pieces} }, totalPieces, totalAmount } } */
function personMonths(pid) {
    const p = getPerson(pid);
    const price = p ? (Number(p.price) || 0) : 0;
    const months = {};
    personEntriesFor(pid).forEach(e => {
        const ym = e.date.slice(0, 7);
        if (!months[ym]) months[ym] = { days: {}, totalPieces: 0, totalAmount: 0 };
        const d = months[ym].days[e.date] || (months[ym].days[e.date] = { pieces: 0 });
        d.pieces += Number(e.pieces) || 0;
        months[ym].totalPieces += Number(e.pieces) || 0;
    });
    Object.values(months).forEach(m => { m.totalAmount = m.totalPieces * price; });
    return months;
}

/* Returns the total pieces for a person in a given "YYYY-MM" */
function personMonthPieces(pid, ym) {
    return personEntriesFor(pid)
        .filter(e => e.date.slice(0, 7) === ym)
        .reduce((s, e) => s + (Number(e.pieces) || 0), 0);
}
function personMonthAmount(pid, ym) {
    const p = getPerson(pid);
    const price = p ? (Number(p.price) || 0) : 0;
    return personMonthPieces(pid, ym) * price;
}

/* ============================================================
   PERSON TABS
   ============================================================ */
function switchTab(tab) {
    homeTab = tab;
    localStorage.setItem(LS_HOME_TAB, tab);

    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('is-active', t.dataset.tab === tab);
    });
    const panelBkash = document.getElementById('panelBkash');
    const panelPerson = document.getElementById('panelPerson');
    if (panelBkash) panelBkash.hidden = tab !== 'bkash';
    if (panelPerson) panelPerson.hidden = tab !== 'person';

    if (tab === 'person') {
        renderPersonHero();
        renderPersonList();
    }
}

document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
});

/* ============================================================
   ROUTER
   ============================================================ */
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
    const viewDay = document.getElementById('viewDay');
    const viewPerson = document.getElementById('viewPerson');
    const viewPersonMonth = document.getElementById('viewPersonMonth');

    const setTitle = (t, s) => {
        document.getElementById('topTitle').textContent = t;
        document.getElementById('topSub').textContent = s;
    };

    /* hide all */
    [viewHome, viewMonth, viewDay, viewPerson, viewPersonMonth].forEach(v => { if (v) v.hidden = true; });

    /* ============ PERSON MONTH  #/person/:id/month/:ym ============ */
    const pm = hash.match(/^person\/([^\/]+)\/month\/(\d{4}-\d{2})$/);
    if (pm) {
        const pid = pm[1], ym = pm[2];
        const p = getPerson(pid);
        if (!p) { navigateTo(''); return; }
        viewPersonMonth.hidden = false;
        document.body.classList.add('in-month');
        setTitle(monthName(ym) + ' ' + ym.slice(0, 4), p.name);
        renderPersonMonthView(pid, ym);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* ============ PERSON  #/person/:id ============ */
    const pp = hash.match(/^person\/([^\/]+)$/);
    if (pp) {
        const pid = pp[1];
        const p = getPerson(pid);
        if (!p) { navigateTo(''); return; }
        viewPerson.hidden = false;
        document.body.classList.add('in-month');
        setTitle(p.name, 'মাসসমূহ');
        renderPersonView(pid);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* ============ DAY ROUTE ============ */
    if (hash.startsWith('day/')) {
        const date = hash.slice(4);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { navigateTo(''); return; }
        viewDay.hidden = false;
        document.body.classList.add('in-month');
        setTitle(weekday(date), fmtDate(date));
        renderDayView(date);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* ============ MONTH ROUTE ============ */
    if (hash.startsWith('month/')) {
        const ym = hash.slice(6);
        if (!/^\d{4}-\d{2}$/.test(ym)) { navigateTo(''); return; }
        viewMonth.hidden = false;
        document.body.classList.add('in-month');
        setTitle(monthName(ym) + ' ' + ym.slice(0, 4), 'মাসের বিস্তারিত');
        renderMonthView(ym);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* ============ HOME ============ */
    viewHome.hidden = false;
    document.body.classList.remove('in-month');
    setTitle('ইজি লেনদেন', 'সালাম ভাইয়ের সাথে লেনদেন');
    renderHome();
    window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', handleRoute);

/* ============================================================
   HOME VIEW
   ============================================================ */
function renderHome() {
    renderHomeHero();
    renderMonthList();
    renderPersonHero();
    renderPersonList();
    switchTab(homeTab);
}

function renderHomeHero() {
    const viewHome = document.getElementById('viewHome');
    if (!viewHome) return;

    const pawna = overallPawna();
    const state = pawnaState(pawna);

    let hero = document.getElementById('homeHero');
    if (!hero) {
        hero = document.createElement('div');
        hero.id = 'homeHero';
        hero.className = 'home-hero';
        viewHome.insertBefore(hero, viewHome.firstChild);
    }

    hero.innerHTML = `
        <div class="home-hero-top">
            <span class="home-hero-label">
                <span class="home-hero-ico">${COIN}</span>
                হাসান পাওনা
            </span>
            <span class="home-hero-badge" data-pawna-state="${state}">
                ${state === 'due' ? 'বাকি' : state === 'advance' ? 'অগ্রিম' : 'পরিশোধিত'}
            </span>
        </div>
        <b class="home-hero-value" data-pawna-state="${state}">৳ ${bn(pawna)}</b>`;
}

function renderMonthList() {
    const months = groupData();
    const keys = Object.keys(months).sort().reverse();
    const el = document.getElementById('monthList');
    document.getElementById('monthCount').textContent = keys.length + ' মাস';

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

    el.innerHTML = keys.map(ym => `
        <article class="month-card">
            <button class="month-btn" data-open-month="${ym}" type="button">
                <div class="month-info">
                    <div class="month-name">${monthName(ym)} ${ym.slice(0, 4)}</div>
                </div>
                <div class="month-total">
                    <div class="amt">৳ ${bn(monthBkashTotal(ym, months))}</div>
                    <div class="cnt">বিকাশ</div>
                </div>
                <span class="month-arrow">${ARROW_RIGHT}</span>
            </button>
        </article>`).join('');
}

/* ============================================================
   MONTH VIEW  (bKash)
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
        dayCountEl.textContent = '0 দিন';
        return;
    }

    mh.style.display = '';
    document.getElementById('mhTitle').textContent = monthName(ym) + ' ' + ym.slice(0, 4);
    const dates = Object.keys(m.days).sort().reverse();

    const mhTotalEl = document.getElementById('mhTotal');
    if (mhTotalEl) mhTotalEl.textContent = '৳ ' + bn(monthBkashTotal(ym, months));

    const mhDepositEl = document.getElementById('mhDeposit');
    if (mhDepositEl) mhDepositEl.textContent = '৳ ' + bn(monthDepositTotal(ym, months));

    dayCountEl.textContent = dates.length + ' দিন';
    dayListEl.innerHTML = dates.map(date => renderDayListItem(date, m.days[date])).join('');
}

function renderDayListItem(date, d) {
    return `
        <div class="day-card" data-day="${date}">
            <button class="day-head" data-td="${date}" type="button">
                <div class="day-chip"><b>${+date.slice(8)}</b></div>
                <div class="day-info">
                    <div class="d1">${weekday(date)}</div>
                    <div class="d2">${d.count} টি নম্বর</div>
                </div>
                <div class="day-amt">৳ ${bn(d.total)}</div>
                <span class="chev">${ARROW_RIGHT}</span>
            </button>
        </div>`;
}

/* ============================================================
   DAY VIEW  (bKash)
   ============================================================ */
function renderDayView(date) {
    const viewDay = document.getElementById('viewDay');
    if (!viewDay) return;

    const months = groupData();
    const m = months[date.slice(0, 7)];
    const d = m && m.days[date];

    if (!d) {
        viewDay.innerHTML = `<div class="empty">
            <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
            <h3>এই দিনে কোনো এন্ট্রি নেই</h3>
            <p>+ বাটনে ক্লিক করে এন্ট্রি যোগ করুন</p>
        </div>`;
        return;
    }

    const { bkash, ejaa, deposit, total } = computeDay(date, d);
    const pawna = total - deposit;
    const state = pawnaState(pawna);
    const reversed = [...d.entries].reverse();

    viewDay.innerHTML = `
        <div class="day-hero">
            <div class="day-hero-top">
                <div class="day-hero-chip">${+date.slice(8)}</div>
                <div class="day-hero-title">
                    <h2>${weekday(date)}</h2>
                    <p>${fmtDate(date)}</p>
                </div>
            </div>
            <div class="day-hero-total">
                <span class="dh-lbl">এই দিনের মোট বিকাশ</span>
                <b>৳ ${bn(d.total)}</b>
                <span class="dh-count">${d.count} টি নম্বর</span>
            </div>
        </div>

        <div class="day-detail-body">
            <div class="day-entries-block">
                <div class="entry-head">
                    <span class="entry-head-title">
                        <span class="dot"></span>
                        নম্বর তালিকা
                    </span>
                    <button class="entry-copy-all" data-copy-all="${date}" type="button">
                        ${COPY_ALL}
                        সব কপি
                    </button>
                </div>
                <div class="entry-list">
                    ${reversed.map(e => `
                        <button class="entry-line" data-copy="${e.number}-${e.amount}" type="button">
                            <span class="entry-ico">${PHONE}</span>
                            <span class="n">${fmtNum(e.number)}</span>
                            <span class="a">৳ ${bn(e.amount)}</span>
                        </button>`).join('')}
                </div>
            </div>

            <div class="day-summary">
                <div class="sum-head">
                    <span class="sum-head-title">
                        <span class="dot"></span>
                        হিসাব
                    </span>
                    <button class="entry-copy-all" data-copy-sum="${date}" type="button">
                        ${COPY_ALL}
                        হিসাব কপি
                    </button>
                </div>

                <div class="sum-grid">
                    <div class="sum-item sum-item--bkash">
                        <span class="sum-label">বিকাশ</span>
                        <span class="sum-value">৳ ${bn(bkash)}</span>
                    </div>
                    <div class="sum-item sum-item--total">
                        <span class="sum-label">টোটাল</span>
                        <span class="sum-value">৳ ${bn(total)}</span>
                    </div>
                    <div class="sum-item sum-item--ejaa">
                        <span class="sum-label">ইজা</span>
                        <span class="sum-value">৳ ${bn(ejaa)}</span>
                    </div>
                    <div class="sum-item sum-item--joma">
                        <span class="sum-label">জমা</span>
                        <span class="sum-value">৳ ${bn(deposit)}</span>
                    </div>
                </div>

                <div class="sum-pawna" data-pawna-state="${state}">
                    <span class="sum-pawna-label">
                        <span class="ico">${COIN}</span>
                        হাসান পাওনা
                    </span>
                    <b class="sum-pawna-value">৳ ${bn(pawna)}</b>
                </div>
            </div>

            <button class="day-delete" data-del="${date}" type="button">
                ${TRASH}
                এই দিনের এন্ট্রি মুছুন
            </button>
        </div>`;
}

/* ============================================================
   PERSON HOME HERO  (top of person tab)
   ============================================================ */
function renderPersonHero() {
    const panel = document.getElementById('panelPerson');
    if (!panel) return;

    let hero = document.getElementById('personHero');
    if (!hero) return;

    const totalPeople = persons.length;
    const totalPieces = persons.reduce((s, p) => s + personTotalPieces(p.id), 0);
    const totalDue = persons.reduce((s, p) => s + Math.max(0, personDue(p.id)), 0);

    hero.className = 'person-hero';
    hero.innerHTML = `
        <div class="person-hero-top">
            <span class="person-hero-label">
                <span class="person-hero-ico">${PERSON_ICON}</span>
                মোট বাকি
            </span>
            <span class="person-hero-badge">${totalPeople} জন</span>
        </div>
        <b class="person-hero-value">৳ ${bn(totalDue)}</b>
        <div style="margin-top:6px;font-family:var(--font-num);font-size:13px;opacity:.85;position:relative;z-index:1;font-variant-numeric:tabular-nums">
            মোট গিলা: <b>${bn(totalPieces)}</b>
        </div>`;
}

/* ============================================================
   PERSON LIST  (cards)
   ============================================================ */
function renderPersonList() {
    const el = document.getElementById('personList');
    const countEl = document.getElementById('personCount');
    if (!el) return;

    countEl.textContent = persons.length + ' জন';

    if (!persons.length) {
        el.innerHTML = `
            <div class="empty">
                <div class="empty-icon">${PERSON_ICON}</div>
                <h3>এখনো কোনো ব্যক্তি নেই</h3>
                <p>উপরের + বাটনে ক্লিক করে ব্যক্তি যোগ করুন</p>
            </div>`;
        return;
    }

    const sorted = [...persons].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'bn'));

    el.innerHTML = `
        <button class="person-add-card" id="personAddCard" type="button">
            <span class="person-add-ico">${PLUS_ICON}</span>
            নতুন ব্যক্তি যোগ করুন
        </button>
    ` + sorted.map(p => {
        const pieces = personTotalPieces(p.id);
        const due = personDue(p.id);
        const initial = (p.name || '?').trim().charAt(0);
        const state = due > 0 ? 'due' : due < 0 ? 'advance' : 'settled';
        return `
            <article class="person-card">
                <button class="person-btn" data-open-person="${p.id}" type="button">
                    <span class="person-avatar"><span>${initial}</span></span>
                    <span class="person-info">
                        <span class="person-name">${p.name || 'নাম নেই'}</span>
                        <span class="person-meta">
                            <span>${bn(pieces)} গিলা</span>
                            <span class="meta-dot"></span>
                            <span>৳ ${bn(p.price || 0)}/গিলা</span>
                        </span>
                    </span>
                    <span class="person-total">
                        <div class="amt" style="color:${state === 'due' ? 'var(--pink)' : state === 'advance' ? 'var(--blue)' : 'var(--green)'}">
                            ৳ ${bn(Math.abs(due))}
                        </div>
                        <div class="cnt">${state === 'due' ? 'বাকি' : state === 'advance' ? 'অগ্রিম' : 'পরিশোধ'}</div>
                    </span>
                    <span class="person-arrow">${ARROW_RIGHT}</span>
                </button>
            </article>`;
    }).join('');
}

/* ============================================================
   PERSON VIEW  (#/person/:id  →  months list)
   ============================================================ */
function renderPersonView(pid) {
    const view = document.getElementById('viewPerson');
    const p = getPerson(pid);
    if (!view || !p) return;

    const months = personMonths(pid);
    const keys = Object.keys(months).sort().reverse();

    const totalPieces = personTotalPieces(pid);
    const totalEarned = personTotalEarned(pid);
    const due = personDue(pid);
    const dueState = due > 0 ? 'due' : due < 0 ? 'advance' : 'settled';
    const initial = (p.name || '?').trim().charAt(0);

    view.innerHTML = `
        <div class="person-view-hero">
            <div class="pvh-top">
                <div class="pvh-avatar">${initial}</div>
                <div class="pvh-title">
                    <h2>${p.name || 'নাম নেই'}</h2>
                    <p>অগ্রিম: ৳ ${bn(p.advance || 0)} • ৳ ${bn(p.price || 0)}/গিলা</p>
                </div>
                <button class="icon-btn" data-edit-person="${pid}" type="button" aria-label="এডিট"
                    style="background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.28)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                    </svg>
                </button>
            </div>

            <div class="pvh-stats">
                <div class="pvh-stat">
                    <span class="pvh-stat-lbl">মোট গিলা</span>
                    <span class="pvh-stat-val">${bn(totalPieces)}</span>
                </div>
                <div class="pvh-stat">
                    <span class="pvh-stat-lbl">মোট আয়</span>
                    <span class="pvh-stat-val">৳ ${bn(totalEarned)}</span>
                </div>
                <div class="pvh-stat">
                    <span class="pvh-stat-lbl">${dueState === 'due' ? 'বাকি' : dueState === 'advance' ? 'অগ্রিম' : 'পরিশোধিত'}</span>
                    <span class="pvh-stat-val">৳ ${bn(Math.abs(due))}</span>
                </div>
            </div>
        </div>

        <div class="section-head">
            <h2 class="section-title"><span class="title-dot"></span>মাসসমূহ</h2>
            <span class="section-count">${keys.length} মাস</span>
        </div>
        <div id="personMonthList">
            ${keys.length ? keys.map(ym => `
                <article class="month-card person-month-card">
                    <button class="month-btn" data-open-pmonth="${pid}|${ym}" type="button">
                        <div class="month-info">
                            <div class="month-name">${monthName(ym)} ${ym.slice(0, 4)}</div>
                        </div>
                        <div class="month-total">
                            <div class="amt">৳ ${bn(personMonthAmount(pid, ym))}</div>
                            <div class="cnt">${bn(personMonthPieces(pid, ym))} গিলা</div>
                        </div>
                        <span class="month-arrow">${ARROW_RIGHT}</span>
                    </button>
                </article>`).join('') : `
                <div class="empty">
                    <div class="empty-icon">${PERSON_ICON}</div>
                    <h3>এই ব্যক্তির কোনো এন্ট্রি নেই</h3>
                    <p>+ বাটনে ক্লিক করে আজকের গিলা যোগ করুন</p>
                </div>`}
        </div>
    `;
}

/* ============================================================
   PERSON MONTH VIEW  (#/person/:id/month/:ym  →  days list)
   ============================================================ */
function renderPersonMonthView(pid, ym) {
    const view = document.getElementById('viewPersonMonth');
    const p = getPerson(pid);
    if (!view || !p) return;

    const months = personMonths(pid);
    const m = months[ym];
    const totalPieces = m ? m.totalPieces : 0;
    const totalAmount = m ? m.totalAmount : 0;

    if (!m) {
        view.innerHTML = `<div class="empty">
            <div class="empty-icon">${PERSON_ICON}</div>
            <h3>এই মাসে কোনো এন্ট্রি নেই</h3>
            <p>+ বাটনে ক্লিক করে গিলা যোগ করুন</p>
        </div>`;
        return;
    }

    const dates = Object.keys(m.days).sort().reverse();

    view.innerHTML = `
        <div class="person-month-hero">
            <h2>${monthName(ym)} ${ym.slice(0, 4)}</h2>
            <div class="pmh-amount">
                <span class="pmh-amount-lbl">এই মাসের মোট</span>
                <b>৳ ${bn(totalAmount)}</b>
                <div style="margin-top:6px;font-family:var(--font-num);font-size:13px;opacity:.88;font-variant-numeric:tabular-nums">
                    ${bn(totalPieces)} গিলা • ৳ ${bn(p.price || 0)}/গিলা
                </div>
            </div>
        </div>

        <div class="section-head">
            <h2 class="section-title"><span class="title-dot"></span>দৈনিক গিলা</h2>
            <span class="section-count">${dates.length} দিন</span>
        </div>
        <div id="personDayList">
            ${dates.map(date => {
        const d = m.days[date];
        const amount = d.pieces * (Number(p.price) || 0);
        return `
                    <div class="pday-card">
                        <button class="pday-head" data-open-pday="${pid}|${date}" type="button">
                            <div class="pday-chip"><b>${+date.slice(8)}</b></div>
                            <div class="pday-info">
                                <div class="d1">${weekday(date)}</div>
                                <div class="d2">${bn(d.pieces)} গিলা</div>
                            </div>
                            <div class="pday-amt">
                                ৳ ${bn(amount)}
                                <small>${bn(d.pieces)} × ৳${bn(p.price || 0)}</small>
                            </div>
                            <span class="pday-arrow">${ARROW_RIGHT}</span>
                        </button>
                    </div>`;
    }).join('')}
        </div>
    `;
}

/* ============================================================
   PERSON SHEET  (add / edit person)
   ============================================================ */
const personSheet = document.getElementById('personSheet');

function openPersonSheet(id) {
    editingPersonId = id || null;
    const p = id ? getPerson(id) : null;

    document.getElementById('personSheetTitle').textContent = p ? 'ব্যক্তি এডিট করুন' : 'নতুন ব্যক্তি';
    document.getElementById('pName').value = p ? p.name : '';
    document.getElementById('pAdvance').value = p ? (p.advance || '') : '';
    document.getElementById('pPrice').value = p ? (p.price || '') : '';
    document.getElementById('personDelete').hidden = !p;

    personSheet.classList.add('show');
    showSheetBg();
    setTimeout(() => document.getElementById('pName').focus(), 380);
}

function closePersonSheet() {
    personSheet.classList.remove('show');
    hideSheetBg();
    editingPersonId = null;
}

document.getElementById('personCancel').onclick = closePersonSheet;

document.getElementById('personSave').onclick = () => {
    const name = document.getElementById('pName').value.trim();
    const advance = parseNum(document.getElementById('pAdvance').value);
    const price = parseNum(document.getElementById('pPrice').value);

    if (!name) return toast('নাম লিখুন', 'err');

    if (editingPersonId) {
        const p = getPerson(editingPersonId);
        if (!p) return;
        p.name = name;
        p.advance = advance;
        p.price = price;
        persistPersons();
        toast('আপডেট হয়েছে', 'ok');
        closePersonSheet();

        if (currentRoute === `person/${p.id}`) renderPersonView(p.id);
        else renderPersonList(), renderPersonHero();
    } else {
        const newP = {
            id: uid('p_'),
            name,
            advance,
            price,
            createdAt: new Date().toISOString()
        };
        persons.push(newP);
        persistPersons();
        toast('যোগ হয়েছে', 'ok');
        closePersonSheet();
        renderPersonList();
        renderPersonHero();
    }
};

document.getElementById('personDelete').onclick = () => {
    if (!editingPersonId) return;
    const pid = editingPersonId;
    askConfirm('ব্যক্তি মুছবেন?', 'এই ব্যক্তির সব গিলার এন্ট্রিও মুছে যাবে।', () => {
        persons = persons.filter(p => p.id !== pid);
        personEntries = personEntries.filter(e => e.personId !== pid);
        persistPersons();
        persistPersonEntries();
        closePersonSheet();
        toast('মুছে ফেলা হয়েছে', 'ok');
        if (currentRoute.startsWith('person/')) navigateTo('');
        else { renderPersonList(); renderPersonHero(); }
    });
};

/* ============================================================
   PERSON DAY SHEET  (add / edit pieces for a day)
   ============================================================ */
const pdaySheet = document.getElementById('pdaySheet');

function openPdaySheet(pid, date) {
    const p = getPerson(pid);
    if (!p) return;
    editingPdayPersonId = pid;
    editingPdayDate = date;

    const existing = personEntries.find(e => e.personId === pid && e.date === date);

    document.getElementById('pdayTitle').textContent = p.name + ' • ' + (existing ? 'এডিট' : 'আজকের গিলা');
    document.getElementById('pdaySub').textContent = 'কত গিলা কাজ হয়েছে লিখুন';
    document.getElementById('pdayDate').value = date;
    document.getElementById('pdayPieces').value = existing ? existing.pieces : '';
    document.getElementById('pdayDelete').hidden = !existing;

    const hint = document.getElementById('pdayHint');
    hint.textContent = `প্রতি গিলার দাম ৳ ${bn(p.price || 0)} — টাকা স্বয়ংক্রিয় হিসাব হবে`;

    pdaySheet.classList.add('show');
    showSheetBg();
    setTimeout(() => document.getElementById('pdayPieces').focus(), 380);
}

function closePdaySheet() {
    pdaySheet.classList.remove('show');
    hideSheetBg();
    editingPdayPersonId = null;
    editingPdayDate = null;
}

document.getElementById('pdaySave').onclick = () => {
    const pid = editingPdayPersonId;
    if (!pid) return;
    const date = document.getElementById('pdayDate').value;
    const pieces = parseNum(document.getElementById('pdayPieces').value);

    if (!date) return toast('তারিখ নির্বাচন করুন', 'err');
    if (pieces <= 0) return toast('গিলা লিখুন', 'err');

    const existing = personEntries.find(e => e.personId === pid && e.date === date);
    if (existing) {
        existing.pieces = pieces;
    } else {
        personEntries.push({
            id: uid('pe_'),
            personId: pid,
            date,
            pieces,
            createdAt: new Date().toISOString()
        });
    }
    persistPersonEntries();
    toast('সেভ হয়েছে', 'ok');
    const savedDate = date;
    closePdaySheet();

    // re-render
    const ym = savedDate.slice(0, 7);
    if (currentRoute === `person/${pid}/month/${ym}`) renderPersonMonthView(pid, ym);
    else if (currentRoute === `person/${pid}`) renderPersonView(pid);
    else if (currentRoute === '') { renderPersonList(); renderPersonHero(); }
};

document.getElementById('pdayDelete').onclick = () => {
    const pid = editingPdayPersonId;
    const date = editingPdayDate;
    if (!pid || !date) return;
    askConfirm('গিলা মুছবেন?', 'এই দিনের গিলার এন্ট্রি মুছে যাবে।', () => {
        personEntries = personEntries.filter(e => !(e.personId === pid && e.date === date));
        persistPersonEntries();
        closePdaySheet();
        toast('মুছে ফেলা হয়েছে', 'ok');
        const ym = date.slice(0, 7);
        if (currentRoute === `person/${pid}/month/${ym}`) renderPersonMonthView(pid, ym);
        else if (currentRoute === `person/${pid}`) renderPersonView(pid);
    });
};

/* ============================================================
   DELEGATED CLICKS
   ============================================================ */
document.addEventListener('click', async ev => {

    /* --- bKash copy-all (numbers) --- */
    const cpAll = ev.target.closest('[data-copy-all]');
    if (cpAll) {
        ev.stopPropagation();
        const date = cpAll.dataset.copyAll;
        const months = groupData();
        const m = months[date.slice(0, 7)];
        const d = m && m.days[date];
        if (!d || !d.entries.length) return;

        const text = [...d.entries].reverse().map(e => `${e.number} = ${e.amount}`).join('\n');
        cpAll.classList.add('copied');
        setTimeout(() => cpAll.classList.remove('copied'), 900);
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
            .then(() => toast(d.entries.length + ' টি নম্বর ও টাকা কপি হয়েছে', 'ok'),
                () => toast('কপি ব্যর্থ', 'err'));
        return;
    }

    /* --- bKash copy-all (summary) --- */
    const cpSum = ev.target.closest('[data-copy-sum]');
    if (cpSum) {
        ev.stopPropagation();
        const date = cpSum.dataset.copySum;
        const months = groupData();
        const m = months[date.slice(0, 7)];
        const d = m && m.days[date];
        if (!d) return;
        const { bkash, ejaa, deposit, total } = computeDay(date, d);
        const pawna = total - deposit;
        const text =
            ` ${fmtDate(date)}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `   বিকাশ : ${bkash}\n` +
            `   ইজা   : ${ejaa}\n` +
            `   ─────────────\n` +
            `   টোটাল : ${total}\n` +
            `\n` +
            `   জমা  : ${deposit}\n` +
            `   ─────────────\n` +
            `   হাসান পাওনা : ${pawna}`;
        cpSum.classList.add('copied');
        setTimeout(() => cpSum.classList.remove('copied'), 900);
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
            .then(() => toast('হিসাব কপি হয়েছে', 'ok'), () => toast('কপি ব্যর্থ', 'err'));
        return;
    }

    /* --- open bKash month --- */
    const openMonthBtn = ev.target.closest('[data-open-month]');
    if (openMonthBtn) {
        navigateTo('month/' + openMonthBtn.dataset.openMonth);
        return;
    }

    /* --- open bKash day --- */
    const td = ev.target.closest('[data-td]');
    if (td) {
        navigateTo('day/' + td.dataset.td);
        return;
    }

    /* --- open person --- */
    const openP = ev.target.closest('[data-open-person]');
    if (openP) {
        navigateTo('person/' + openP.dataset.openPerson);
        return;
    }

    /* --- open person month --- */
    const openPM = ev.target.closest('[data-open-pmonth]');
    if (openPM) {
        const [pid, ym] = openPM.dataset.openPmonth.split('|');
        navigateTo(`person/${pid}/month/${ym}`);
        return;
    }

    /* --- open person day (sheet) --- */
    const openPD = ev.target.closest('[data-open-pday]');
    if (openPD) {
        const [pid, date] = openPD.dataset.openPday.split('|');
        openPdaySheet(pid, date);
        return;
    }

    /* --- edit person --- */
    const editP = ev.target.closest('[data-edit-person]');
    if (editP) {
        openPersonSheet(editP.dataset.editPerson);
        return;
    }

    /* --- add person (button inside list) --- */
    const addP = ev.target.closest('#personAddCard');
    if (addP) {
        openPersonSheet(null);
        return;
    }

    /* --- bKash copy line --- */
    const cp = ev.target.closest('[data-copy]');
    const del = ev.target.closest('[data-del]');

    if (del) {
        ev.stopPropagation();
        const date = del.dataset.del;
        const ym = date.slice(0, 7);
        askConfirm('এন্ট্রি মুছবেন?', 'এই দিনের সব এন্ট্রি ও হিসাব মুছে যাবে। এটি ফেরানো যাবে না।', async () => {
            try {
                await removeByDate(date);
                toast('মুছে ফেলা হয়েছে', 'ok');
                navigateTo('month/' + ym);
            } catch (err) {
                toast('মুছা ব্যর্থ: ' + err.message, 'err');
            }
        });
    } else if (cp) {
        const num = cp.dataset.copy;
        cp.classList.add('copied');
        setTimeout(() => cp.classList.remove('copied'), 900);
        (navigator.clipboard ? navigator.clipboard.writeText(num) : Promise.reject())
            .then(() => toast('নম্বর ও টাকা কপি হয়েছে', 'ok'), () => toast(num));
    }
});

/* ============================================================
   ADD BUTTON  —  context-aware
   ============================================================ */
document.getElementById('addTop').onclick = () => {
    // Person routes
    const pmatch = currentRoute.match(/^person\/([^\/]+)(?:\/month\/(\d{4}-\d{2}))?$/);
    if (pmatch) {
        const pid = pmatch[1];
        const ym = pmatch[2];
        const date = ym ? (todayStr().slice(0, 7) === ym ? todayStr() : ym + '-01') : todayStr();
        openPdaySheet(pid, date);
        return;
    }
    // Person tab on home
    if (homeTab === 'person') {
        openPersonSheet(null);
        return;
    }
    // Default: bKash entry
    openSheet();
};

/* ============================================================
   BACK BUTTON
   ============================================================ */
document.getElementById('backBtn').onclick = () => {
    const r = currentRoute;

    // person/:id/month/:ym → person/:id
    const pm = r.match(/^person\/([^\/]+)\/month\//);
    if (pm) { navigateTo('person/' + pm[1]); return; }

    // person/:id → home (person tab)
    if (r.startsWith('person/')) { navigateTo(''); return; }

    // day/:date → month/:ym
    if (r.startsWith('day/')) { navigateTo('month/' + r.slice(4, 11)); return; }

    // month/:ym → home
    if (r.startsWith('month/')) { navigateTo(''); return; }

    // home → dashboard
    window.location.replace('/');
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
   BOOT
   ============================================================ */
(async function init() {
    loadPersonData();
    await fetchRecords();
    handleRoute();
})();