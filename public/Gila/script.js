/* ============================================================
   API LAYER  —  backend contract
   ============================================================
   GET    /Gila/persons                     -> Person[]
   POST   /Gila/persons                     -> Person
   PUT    /Gila/persons/:id                 -> Person
   DELETE /Gila/persons/:id                 -> 204

   GET    /Gila/persons/:id/entries         -> Entry[]
   PUT    /Gila/persons/:id/entries/:date   -> Entry     (upsert)
   DELETE /Gila/persons/:id/entries/:date   -> 204

   Person = { id|_id, name, advance, price, totalPieces? }
   Entry  = { id|_id?, personId?, date: 'YYYY-MM-DD', pieces }

   Responses may be raw or wrapped in { data: ... }  — both work.
   ============================================================ */

const API_BASE = '/Gila';

class ApiError extends Error {
    constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; }
}

/* unwrap { data: ... } envelopes transparently */
const unwrap = j => (j && typeof j === 'object' && 'data' in j ? j.data : j);

/* accept both `id` and `_id` from the server */
const readId = obj => (obj && (obj.id ?? obj._id)) || null;

async function request(path, { method = 'GET', body } = {}) {
    let res;
    try {
        res = await fetch(API_BASE + path, {
            method,
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new ApiError('সার্ভারে সংযোগ করা যায়নি', 0);
    }

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* ignore */ }
        throw new ApiError(msg, res.status);
    }
    if (res.status === 204) return null;

    const text = await res.text();
    if (!text) return null;
    try { return unwrap(JSON.parse(text)); }
    catch { throw new ApiError('সার্ভার ভুল ফরম্যাটে ডেটা পাঠিয়েছে', res.status); }
}

/* ============================================================
   API CLIENT
   ============================================================ */
const api = {
    listPersons: () =>
        request('/persons'),

    createPerson: body =>
        request('/persons', { method: 'POST', body }),

    updatePerson: (id, body) =>
        request(`/persons/${encodeURIComponent(id)}`, { method: 'PUT', body }),

    deletePerson: id =>
        request(`/persons/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    listEntries: pid =>
        request(`/persons/${encodeURIComponent(pid)}/entries`),

    upsertEntry: (pid, date, pieces) =>
        request(`/persons/${encodeURIComponent(pid)}/entries/${encodeURIComponent(date)}`, {
            method: 'PUT',
            body: { pieces },
        }),

    deleteEntry: (pid, date) =>
        request(`/persons/${encodeURIComponent(pid)}/entries/${encodeURIComponent(date)}`, {
            method: 'DELETE',
        }),
};

/* ============================================================
   STATE
   ============================================================ */
let persons = [];
let personEntries = [];                 // cache of entries for *loaded* persons
const entriesLoaded = new Set();        // which person ids have their entries cached
let currentRoute = '';

let editingPersonId = null;
let editingPdayPersonId = null;
let editingPdayDate = null;

let confirmCb = null;

let routeToken = 0;                     // guards against out-of-order async renders

/* ============================================================
   HELPERS
   ============================================================ */
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

/* NEW: ISO date (YYYY-MM-DD) -> DD/MM/YYYY */
function formatDateDMY(isoDate) {
    if (!isoDate) return '';
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getPerson(id) { return persons.find(p => p.id === id); }

function personEntriesFor(pid) { return personEntries.filter(e => e.personId === pid); }

function personTotalPieces(pid) {
    if (entriesLoaded.has(pid)) {
        return personEntriesFor(pid).reduce((s, e) => s + (Number(e.pieces) || 0), 0);
    }
    return Number(getPerson(pid)?.totalPieces) || 0;
}

function personMonths(pid) {
    const months = {};
    personEntriesFor(pid).forEach(e => {
        const ym = e.date.slice(0, 7);
        if (!months[ym]) months[ym] = { days: {}, totalPieces: 0 };
        const d = months[ym].days[e.date] || (months[ym].days[e.date] = { pieces: 0 });
        d.pieces += Number(e.pieces) || 0;
        months[ym].totalPieces += Number(e.pieces) || 0;
    });
    return months;
}
function personMonthPieces(pid, ym) {
    return personEntriesFor(pid)
        .filter(e => e.date.slice(0, 7) === ym)
        .reduce((s, e) => s + (Number(e.pieces) || 0), 0);
}

function todayStr(d = new Date()) {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/* disable a button while an async action runs */
async function withBusy(btn, fn) {
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('is-busy');
    try { await fn(); }
    catch (e) { toast(e?.message || 'কিছু ভুল হয়েছে', 'err'); }
    finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}

/* ============================================================
   DATA ACCESS
   ============================================================ */
async function refreshPersons() {
    const list = await api.listPersons();

    persons = (list || []).map(p => ({
        id: String(readId(p) ?? ''),
        name: p.name ?? '',
        advance: Number(p.advance) || 0,
        price: Number(p.price) || 0,
        totalPieces: Number(p.totalPieces) || 0,
    }));
}

async function ensureEntries(pid) {
    if (entriesLoaded.has(pid)) return;
    const list = await api.listEntries(pid);
    personEntries = personEntries.filter(e => e.personId !== pid);
    (list || []).forEach(e => {
        personEntries.push({
            id: readId(e),
            personId: e.personId || pid,
            date: e.date,
            pieces: Number(e.pieces) || 0,
        });
    });
    entriesLoaded.add(pid);
}

function dropEntriesCache(pid) {
    entriesLoaded.delete(pid);
    personEntries = personEntries.filter(e => e.personId !== pid);
}

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
    const cb = confirmCb;
    confirmCb = null;
    if (cb) {
        try { await cb(); }
        catch (e) { toast(e?.message || 'কিছু ভুল হয়েছে', 'err'); }
    }
};

/* ============================================================
   ICONS
   ============================================================ */
const ARROW_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
const PERSON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

/* ============================================================
   SHEET HELPERS
   ============================================================ */
const sheetBg = document.getElementById('sheetBg');
function showSheetBg() { sheetBg.classList.add('show'); document.body.style.overflow = 'hidden'; }
function hideSheetBg() { sheetBg.classList.remove('show'); document.body.style.overflow = ''; }
sheetBg.onclick = () => { closePersonSheet(); closePdaySheet(); };

/* ============================================================
   ROUTER
   ============================================================ */
function navigateTo(route) {
    const hash = route ? '#/' + route : '#/';
    if (location.hash === hash) { handleRoute(); return; }
    location.hash = hash;
}

async function handleRoute() {
    const token = ++routeToken;
    const hash = location.hash.replace(/^#\/?/, '');
    currentRoute = hash;

    const viewHome = document.getElementById('viewHome');
    const viewPerson = document.getElementById('viewPerson');
    const viewPersonMonth = document.getElementById('viewPersonMonth');
    [viewHome, viewPerson, viewPersonMonth].forEach(v => { if (v) v.hidden = true; });

    const setTitle = (t, s) => {
        document.getElementById('topTitle').textContent = t;
        document.getElementById('topSub').textContent = s;
    };

    /* person month */
    const pm = hash.match(/^person\/([^\/]+)\/month\/(\d{4}-\d{2})$/);
    if (pm) {
        const pid = pm[1], ym = pm[2];
        const p = getPerson(pid);
        if (!p) { navigateTo(''); return; }

        viewPersonMonth.hidden = false;
        document.body.classList.add('in-month');
        setTitle(monthName(ym) + ' ' + ym.slice(0, 4), p.name);

        try { await ensureEntries(pid); }
        catch (e) { toast(e?.message || 'ডেটা লোড হয়নি', 'err'); }
        if (token !== routeToken) return;

        renderPersonMonthView(pid, ym);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* person */
    const pp = hash.match(/^person\/([^\/]+)$/);
    if (pp) {
        const pid = pp[1];
        const p = getPerson(pid);
        if (!p) { navigateTo(''); return; }

        viewPerson.hidden = false;
        document.body.classList.add('in-month');
        setTitle(p.name, 'মাসসমূহ');

        try { await ensureEntries(pid); }
        catch (e) { toast(e?.message || 'ডেটা লোড হয়নি', 'err'); }
        if (token !== routeToken) return;

        renderPersonView(pid);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* home */
    viewHome.hidden = false;
    document.body.classList.remove('in-month');
    setTitle('ইজিলেনদেন', 'গিলার হিসাব');
    renderHome();
    window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', () => { handleRoute(); });

/* ============================================================
   HOME VIEW
   ============================================================ */
function renderHome() {
    renderPersonList();
}

function renderPersonList() {
    const el = document.getElementById('personList');
    const countEl = document.getElementById('personCount');
    if (!el) return;

    countEl.textContent = persons.length + ' জন';

    if (!persons.length) {
        el.innerHTML = `<div class="empty">
            <div class="empty-icon">${PERSON_ICON}</div>
            <h3>এখনো কোনো ব্যক্তি নেই</h3>
            <p>নিচের + বাটনে ক্লিক করে ব্যক্তি যোগ করুন</p>
        </div>`;
        return;
    }

    const sorted = [...persons].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'bn'));


    el.innerHTML = sorted.map(p => {
        const pieces = personTotalPieces(p.id);
        return `
            <article class="person-card">
                <button class="person-btn" data-open-person="${p.id}" type="button">
                    <span class="person-name">${p.name || 'নাম নেই'}</span>
                    <span class="person-total">
                        <span class="amt">${bn(pieces)}</span>
                        <span class="cnt">গিলা</span>
                    </span>
                </button>
            </article>`;
    }).join('');
}

/* ============================================================
   PERSON VIEW  (months list)
   ============================================================ */
function renderPersonView(pid) {
    const view = document.getElementById('viewPerson');
    const p = getPerson(pid);
    if (!view || !p) return;

    const months = personMonths(pid);
    const keys = Object.keys(months).sort().reverse();
    const totalPieces = personTotalPieces(pid);

    /* টার্গেট = অগ্রিম ÷ গিলার দাম */
    const target = (p.price > 0) ? Math.ceil((p.advance || 0) / p.price) : 0;

    view.innerHTML = `
        <div class="person-view-hero">
            <div class="pvh-top">
                <div class="pvh-title">
                    <h2>${p.name || 'নাম নেই'}</h2>
                 
                </div>
                <button class="icon-btn pvh-edit" data-edit-person="${pid}" type="button" aria-label="এডিট">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                    </svg>
                </button>
            </div>

            <div class="pvh-grid">
                <div class="pvh-cell">
                    <span class="pvh-cell-lbl">গিলার দাম</span>
                    <span class="pvh-cell-val">৳ ${bn(p.price || 0)}</span>
                </div>
                <div class="pvh-cell">
                    <span class="pvh-cell-lbl">অগ্রিম</span>
                    <span class="pvh-cell-val">৳ ${bn(p.advance || 0)}</span>
                </div>
                <div class="pvh-cell">
                    <span class="pvh-cell-lbl">মোট গিলা</span>
                    <span class="pvh-cell-val">${bn(totalPieces)}</span>
                </div>
                <div class="pvh-cell">
                    <span class="pvh-cell-lbl">টার্গেট</span>
                    <span class="pvh-cell-val">${bn(target)}</span>
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
                            <div class="amt">${bn(personMonthPieces(pid, ym))}</div>
                            <div class="cnt">গিলা</div>
                        </div>
                        <span class="month-arrow">${ARROW_RIGHT}</span>
                    </button>
                </article>`).join('') : `
                <div class="empty">
                    <div class="empty-icon">${PERSON_ICON}</div>
                    <h3>এই ব্যক্তির কোনো এন্ট্রি নেই</h3>
                    <p>+ বাটনে ক্লিক করে গিলা যোগ করুন</p>
                </div>`}
        </div>
    `;
}
/* ছোট মাসের নাম (চিপে দেখানোর জন্য) */
const SHORT_MONTHS = ['জানু', 'ফেব', 'মার্চ', 'এপ্রি', 'মে', 'জুন',
    'জুল', 'আগ', 'সেপ', 'অক্টো', 'নভে', 'ডিসে'];
const shortMonthName = ym => SHORT_MONTHS[+ym.split('-')[1] - 1];

/* ISO date (YYYY-MM-DD) -> DD/MM/YYYY */
function formatDateDMY(isoDate) {
    if (!isoDate) return '';
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
/* ============================================================
   PERSON MONTH VIEW  (days list)
   ============================================================ */
function renderPersonMonthView(pid, ym) {
    const view = document.getElementById('viewPersonMonth');
    const p = getPerson(pid);
    if (!view || !p) return;

    const months = personMonths(pid);
    const m = months[ym];
    const totalPieces = m ? m.totalPieces : 0;

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
                <span class="pmh-amount-lbl">এই মাসের মোট গিলা</span>
                <b>${bn(totalPieces)}</b>
            </div>
        </div>

        <div class="section-head">
            <h2 class="section-title"><span class="title-dot"></span>দৈনিক গিলা</h2>
            <span class="section-count">${dates.length} দিন</span>
        </div>

                <div id="personDayList">
            ${dates.map(date => {
        const d = m.days[date];
        return `
                    <div class="pday-simple" data-open-pday="${pid}|${date}" role="button" tabindex="0">
                        <div class="pday-simple-day">${+date.slice(8)}</div>
                        <div class="pday-simple-weekday">${weekday(date)}</div>
                        <div class="pday-simple-amt">${bn(d.pieces)} <small>গিলা</small></div>
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

document.getElementById('personSave').onclick = function () {
    const btn = this;
    const name = document.getElementById('pName').value.trim();
    const advance = parseNum(document.getElementById('pAdvance').value);
    const price = parseNum(document.getElementById('pPrice').value);

    if (!name) { toast('নাম দিন', 'err'); return; }

    const id = editingPersonId;

    withBusy(btn, async () => {
        if (id) {
            const updated = await api.updatePerson(id, { name, advance, price });
            const p = getPerson(id);
            if (p) Object.assign(p, {
                name: updated?.name ?? name,
                advance: Number(updated?.advance ?? advance) || 0,
                price: Number(updated?.price ?? price) || 0,
            });
            closePersonSheet();
            toast('আপডেট হয়েছে', 'ok');
            if (currentRoute === `person/${id}`) renderPersonView(id);
            else renderPersonList();
        } else {
            const created = await api.createPerson({ name, advance, price });

            const newId = readId(created);
            if (!newId) throw new ApiError('সার্ভার আইডি ফেরত দেয়নি', 500);

            persons.push({
                id: String(newId),
                name: created?.name ?? name,
                advance: Number(created?.advance ?? advance) || 0,
                price: Number(created?.price ?? price) || 0,
                totalPieces: 0,
            });

            closePersonSheet();
            toast('যোগ হয়েছে', 'ok');
            renderPersonList();
        }
    });
};

document.getElementById('personDelete').onclick = function () {
    const btn = this;
    if (!editingPersonId) return;
    const pid = editingPersonId;

    askConfirm('ব্যক্তি মুছবেন?', 'এই ব্যক্তির সব গিলার এন্ট্রিও মুছে যাবে।', async () => {
        await withBusy(btn, async () => {
            await api.deletePerson(pid);
            persons = persons.filter(p => p.id !== pid);
            dropEntriesCache(pid);
            closePersonSheet();
            toast('মুছে ফেলা হয়েছে', 'ok');
            if (currentRoute.startsWith('person/')) navigateTo('');
            else renderPersonList();
        });
    });
};

/* ============================================================
   PERSON DAY SHEET  (add / edit gila for a day)
   ============================================================ */
const pdaySheet = document.getElementById('pdaySheet');

async function openPdaySheet(pid, date) {
    const p = getPerson(pid);
    if (!p) return;

    try { await ensureEntries(pid); }
    catch (e) { toast(e?.message || 'ডেটা লোড হয়নি', 'err'); return; }

    editingPdayPersonId = pid;
    editingPdayDate = date;

    const existing = personEntries.find(e => e.personId === pid && e.date === date);

    document.getElementById('pdayTitle').textContent = p.name;
    document.getElementById('pdaySub').textContent = existing
        ? 'এই দিনের এন্ট্রি এডিট করুন'
        : 'আজ কত গিলা হয়েছে?';

    /* date picker: native picker stores YYYY-MM-DD, display shows DD/MM/YYYY */
    const pickerInput = document.getElementById('pdayDatePicker');
    const displayInput = document.getElementById('pdayDateDisplay');
    pickerInput.value = date;
    displayInput.value = formatDateDMY(date);

    /* pieces stepper default value */
    document.getElementById('pdayPieces').value = existing ? existing.pieces : 1;

    document.getElementById('pdayDelete').hidden = !existing;

    const hint = document.getElementById('pdayHint');
    hint.textContent = existing ? 'এই দিনের এন্ট্রি এডিট করছেন' : weekday(date);

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

document.getElementById('pdayCancel').onclick = closePdaySheet;

/* date picker change → update display + hint */
document.getElementById('pdayDatePicker').onchange = (e) => {
    const val = e.target.value;
    if (val) {
        document.getElementById('pdayDateDisplay').value = formatDateDMY(val);
        document.getElementById('pdayHint').textContent = weekday(val);
        editingPdayDate = val;
    }
};

/* stepper buttons */
document.getElementById('pdayMinus').onclick = () => {
    const inp = document.getElementById('pdayPieces');
    const val = parseNum(inp.value);
    if (val > 1) inp.value = val - 1;
    else inp.value = 1;
};
document.getElementById('pdayPlus').onclick = () => {
    const inp = document.getElementById('pdayPieces');
    const val = parseNum(inp.value);
    inp.value = val + 1;
};

document.getElementById('pdaySave').onclick = function () {
    const btn = this;
    const pid = editingPdayPersonId;
    if (!pid) return;

    const date = document.getElementById('pdayDatePicker').value;
    const pieces = parseNum(document.getElementById('pdayPieces').value);

    if (!date) { toast('তারিখ নির্বাচন করুন', 'err'); return; }
    if (pieces <= 0) { toast('গিলা লিখুন', 'err'); return; }

    withBusy(btn, async () => {
        const saved = await api.upsertEntry(pid, date, pieces);

        const entry = {
            id: readId(saved),
            personId: pid,
            date: saved?.date || date,
            pieces: Number(saved?.pieces ?? pieces) || 0,
        };
        const i = personEntries.findIndex(e => e.personId === pid && e.date === entry.date);
        if (i >= 0) personEntries[i] = entry;
        else personEntries.push(entry);
        entriesLoaded.add(pid);

        closePdaySheet();
        toast('সেভ হয়েছে', 'ok');

        const ym = entry.date.slice(0, 7);
        if (currentRoute === `person/${pid}/month/${ym}`) renderPersonMonthView(pid, ym);
        else if (currentRoute === `person/${pid}`) renderPersonView(pid);
        else if (currentRoute === '') renderPersonList();
    });
};

document.getElementById('pdayDelete').onclick = function () {
    const btn = this;
    const pid = editingPdayPersonId;
    const date = editingPdayDate;
    if (!pid || !date) return;

    askConfirm('গিলা মুছবেন?', 'এই দিনের এন্ট্রি মুছে যাবে।', async () => {
        await withBusy(btn, async () => {
            await api.deleteEntry(pid, date);
            personEntries = personEntries.filter(e => !(e.personId === pid && e.date === date));
            closePdaySheet();
            toast('মুছে ফেলা হয়েছে', 'ok');

            const ym = date.slice(0, 7);
            if (currentRoute === `person/${pid}/month/${ym}`) renderPersonMonthView(pid, ym);
            else if (currentRoute === `person/${pid}`) renderPersonView(pid);
        });
    });
};

/* ============================================================
   DELEGATED CLICKS
   ============================================================ */
document.addEventListener('click', ev => {
    const openP = ev.target.closest('[data-open-person]');
    if (openP) { navigateTo('person/' + openP.dataset.openPerson); return; }

    const openPM = ev.target.closest('[data-open-pmonth]');
    if (openPM) {
        const [pid, ym] = openPM.dataset.openPmonth.split('|');
        navigateTo(`person/${pid}/month/${ym}`);
        return;
    }

    const openPD = ev.target.closest('[data-open-pday]');
    if (openPD) {
        const [pid, date] = openPD.dataset.openPday.split('|');
        openPdaySheet(pid, date);
        return;
    }

    const editP = ev.target.closest('[data-edit-person]');
    if (editP) { openPersonSheet(editP.dataset.editPerson); return; }

    const addP = ev.target.closest('#personAddCard');
    if (addP) { openPersonSheet(null); return; }
});

/* ============================================================
   ADD BUTTON  (context-aware)
   ============================================================ */
document.getElementById('addTop').onclick = () => {
    const pmatch = currentRoute.match(/^person\/([^\/]+)(?:\/month\/(\d{4}-\d{2}))?$/);
    if (pmatch) {
        const pid = pmatch[1];
        const ym = pmatch[2];
        const date = ym ? (todayStr().slice(0, 7) === ym ? todayStr() : ym + '-01') : todayStr();
        openPdaySheet(pid, date);
        return;
    }
    openPersonSheet(null);
};

/* ============================================================
   BACK BUTTON
   ============================================================ */
document.getElementById('backBtn').onclick = () => {
    const r = currentRoute;
    const pm = r.match(/^person\/([^\/]+)\/month\//);
    if (pm) { navigateTo('person/' + pm[1]); return; }
    if (r.startsWith('person/')) { navigateTo(''); return; }
    window.location.replace('/');
};

/* ============================================================
   TOPBAR SHADOW
   ============================================================ */
const topbar = document.getElementById('topbar');
window.addEventListener('scroll', () => topbar.classList.toggle('scrolled', window.scrollY > 8), { passive: true });

/* ============================================================
   BOOT
   ============================================================ */
async function boot() {
    try {
        await refreshPersons();
    } catch (e) {
        toast(e?.message || 'ডেটা লোড করা যায়নি', 'err');
    }
    handleRoute();
}

boot();