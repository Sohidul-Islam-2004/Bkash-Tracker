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

let loadError = null;                // set when the person list failed to load
let editingPdayOriginal = null;      // date of the entry being edited (null = new entry)

let routeToken = 0;                     // guards against out-of-order async renders
const { esc, num: bn, parseNum, monthName, weekday, todayStr, toast } = App;

/* ============================================================
   HELPERS
   ============================================================ */

/* NEW: ISO date (YYYY-MM-DD) -> DD/MM/YYYY */
/* ISO date (YYYY-MM-DD) -> D/M/YY  (no leading zeros, 2-digit year) */
function formatDateDMY(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    if (!d) return isoDate;
    return `${+d}/${+m}/${y.slice(-2)}`;
}

/* YYYY-MM -> M/YY  (no leading zero, 2-digit year) */
function formatMonthMY(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return `${+m}/${y.slice(-2)}`;
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
    loadError = null;

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
            date: String(e.date).slice(0, 10),
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
   CONFIRM
   ============================================================ */
const confirmEl = document.getElementById('confirm');
function askConfirm(title, msg, cb, yesLabel = 'হ্যাঁ, মুছুন') {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    document.getElementById('confirmYes').textContent = yesLabel;
    confirmCb = cb;
    confirmEl.classList.add('show');
    document.getElementById('confirmNo').focus();
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
let lastFocus = null;
function showSheetBg() {
    lastFocus = document.activeElement;
    sheetBg.classList.add('show');
    document.body.style.overflow = 'hidden';
}
function hideSheetBg() {
    sheetBg.classList.remove('show');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
}
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

    const addTop = document.getElementById('addTop');
    addTop.setAttribute('aria-label', hash.startsWith('person/') ? 'গিলা যোগ করুন' : 'নতুন ব্যক্তি');

    const loadingHTML = '<div class="skeleton skeleton-hero"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>';

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

        if (!entriesLoaded.has(pid)) viewPersonMonth.innerHTML = loadingHTML;
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

        if (!entriesLoaded.has(pid)) viewPerson.innerHTML = loadingHTML;
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
    setTitle('গিলার হিসাব', 'সব ব্যক্তি');
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

    const searchEl = document.getElementById('personSearch');
    if (searchEl) searchEl.parentElement.hidden = persons.length < 6;

    if (loadError && !persons.length) {
        el.innerHTML = `<div class="empty">
            <div class="empty-icon">${PERSON_ICON}</div>
            <h3>ডেটা লোড হয়নি</h3>
            <p>${esc(loadError)}</p>
            <button class="btn btn-primary empty-action" data-retry type="button">আবার চেষ্টা করুন</button>
        </div>`;
        return;
    }

    if (!persons.length) {
        el.innerHTML = `<div class="empty">
            <div class="empty-icon">${PERSON_ICON}</div>
            <h3>এখনো কোনো ব্যক্তি নেই</h3>
            <p>নিচের + বাটনে ক্লিক করে ব্যক্তি যোগ করুন</p>
        </div>`;
        return;
    }

    const q = (searchEl?.value || '').trim().toLowerCase();
    const sorted = persons
        .filter(p => !q || (p.name || '').toLowerCase().includes(q))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'bn'));

    if (!sorted.length) {
        el.innerHTML = `<div class="empty">
            <div class="empty-icon">${PERSON_ICON}</div>
            <h3>কাউকে পাওয়া যায়নি</h3>
            <p>অন্য নামে খুঁজে দেখুন</p>
        </div>`;
        return;
    }

    el.innerHTML = sorted.map(p => {
        const pieces = personTotalPieces(p.id);
        return `
            <article class="person-card">
                <button class="person-btn" data-open-person="${esc(p.id)}" type="button">
                    <span class="person-name">${esc(p.name) || 'নাম নেই'}</span>
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
    const remaining = target - totalPieces;
    const pct = target > 0 ? Math.min(100, Math.round((totalPieces / target) * 100)) : 0;
    const progressHTML = target > 0 ? `
            <div class="pvh-progress">
                <div class="pvh-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
                    <span style="width:${pct}%"></span>
                </div>
                <p class="pvh-progress-txt">${remaining > 0
            ? `অগ্রিম মেটাতে আরও ${bn(remaining)} গিলা বাকি`
            : remaining === 0 ? 'অগ্রিম পুরোপুরি মিটেছে'
                : `অগ্রিমের চেয়ে ${bn(-remaining)} গিলা বেশি হয়েছে`}</p>
            </div>` : '';

    view.innerHTML = `
        <div class="person-view-hero">
            <div class="pvh-top">
                <div class="pvh-title">
                    <h2>${esc(p.name) || 'নাম নেই'}</h2>
                 
                </div>
                <button class="icon-btn pvh-edit" data-edit-person="${esc(pid)}" type="button" aria-label="এডিট">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                    </svg>
                </button>
            </div>

            <div class="pvh-grid">
                            <div class="pvh-cell">
                    <span class="pvh-cell-lbl">অগ্রিম</span>
                    <span class="pvh-cell-val">৳ ${bn(p.advance || 0)}</span>
                </div>
                <div class="pvh-cell">
                    <span class="pvh-cell-lbl">টার্গেট</span>
                    <span class="pvh-cell-val">${bn(target)}</span>
                </div>
                <div class="pvh-cell">
                    <span class="pvh-cell-lbl">গিলার দাম</span>
                    <span class="pvh-cell-val">৳ ${bn(p.price || 0)}</span>
                </div>

                <div class="pvh-cell">
                    <span class="pvh-cell-lbl">মোট গিলা</span>
                    <span class="pvh-cell-val">${bn(totalPieces)}</span>
                </div>
                
            </div>${progressHTML}
        </div>

        <div class="section-head">
            <h2 class="section-title"><span class="title-dot"></span>মাসসমূহ</h2>
            <span class="section-count">${keys.length} মাস</span>
        </div>
        <div id="personMonthList">
            ${keys.length ? keys.map(ym => `
                <article class="month-card person-month-card">
                    <button class="month-btn" data-open-pmonth="${esc(pid)}|${ym}" type="button">
       <div class="month-info">
    <div class="month-name">1/${formatMonthMY(ym)}</div>
    <div class="month-year">${monthName(ym)}</div>
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
                  <div class="pday-simple" data-open-pday="${esc(pid)}|${date}" role="button" tabindex="0">
    <div class="pday-simple-left">
        <div class="pday-simple-day">${formatDateDMY(date)}</div>
        <div class="pday-simple-weekday">${weekday(date)}</div>
    </div>
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
    personSheet.setAttribute('aria-hidden', 'false');
    showSheetBg();
    setTimeout(() => document.getElementById('pName').focus(), 380);
}
function closePersonSheet() {
    personSheet.classList.remove('show');
    personSheet.setAttribute('aria-hidden', 'true');
    hideSheetBg();
    editingPersonId = null;
}
document.getElementById('personCancel').onclick = closePersonSheet;

document.getElementById('personSave').onclick = function () {
    const btn = this;
    const name = document.getElementById('pName').value.trim();
    const advance = Math.max(0, parseNum(document.getElementById('pAdvance').value));
    const price = Math.max(0, parseNum(document.getElementById('pPrice').value));

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
            if (currentRoute === `person/${id}`) {
                document.getElementById('topTitle').textContent = getPerson(id)?.name || name;
                renderPersonView(id);
            }
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
    editingPdayOriginal = existing ? date : null;
    document.getElementById('pdaySub').textContent = existing
        ? 'এই দিনের এন্ট্রি এডিট করুন'
        : (date === todayStr() ? 'আজ কত গিলা হয়েছে?' : 'এই দিনে কত গিলা হয়েছে?');

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
    pdaySheet.setAttribute('aria-hidden', 'false');
    showSheetBg();
    setTimeout(() => document.getElementById('pdayPieces').focus(), 380);
}
function closePdaySheet() {
    pdaySheet.classList.remove('show');
    pdaySheet.setAttribute('aria-hidden', 'true');
    hideSheetBg();
    editingPdayPersonId = null;
    editingPdayDate = null;
    editingPdayOriginal = null;
}

document.getElementById('pdayCancel').onclick = closePdaySheet;

/* date picker change → update display + hint */
document.getElementById('pdayDatePicker').onchange = (e) => {
    const val = e.target.value;
    if (val) {
        document.getElementById('pdayDateDisplay').value = formatDateDMY(val);
        document.getElementById('pdayHint').textContent = weekday(val);
        editingPdayDate = val;
        if (!editingPdayOriginal) document.getElementById('pdaySub').textContent =
            val === todayStr() ? 'আজ কত গিলা হয়েছে?' : 'এই দিনে কত গিলা হয়েছে?';
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

/* re-render whichever view is on screen after entries changed */
function rerenderCurrent(pid) {
    const mm = currentRoute.match(/^person\/([^\/]+)\/month\/(\d{4}-\d{2})$/);
    if (mm) {
        /* last entry of this month gone -> back to the months list */
        if (!personMonths(pid)[mm[2]]) { navigateTo('person/' + pid); return; }
        renderPersonMonthView(pid, mm[2]);
    } else if (currentRoute === `person/${pid}`) renderPersonView(pid);
    else if (currentRoute === '') renderPersonList();
}

document.getElementById('pdaySave').onclick = function () {
    const btn = this;
    const pid = editingPdayPersonId;
    if (!pid) return;

    const date = document.getElementById('pdayDatePicker').value;
    const pieces = parseNum(document.getElementById('pdayPieces').value);
    const original = editingPdayOriginal;          // date the entry had when the sheet opened

    if (!date) { toast('তারিখ নির্বাচন করুন', 'err'); return; }
    if (pieces <= 0) { toast('গিলা লিখুন', 'err'); return; }

    const doSave = () => withBusy(btn, async () => {
        const saved = await api.upsertEntry(pid, date, pieces);

        /* date changed on an existing entry = move it, don't leave a copy behind */
        if (original && original !== date) {
            await api.deleteEntry(pid, original);
            personEntries = personEntries.filter(e => !(e.personId === pid && e.date === original));
        }

        const entry = {
            id: readId(saved),
            personId: pid,
            date: String(saved?.date || date).slice(0, 10),
            pieces: Number(saved?.pieces ?? pieces) || 0,
        };
        const i = personEntries.findIndex(e => e.personId === pid && e.date === entry.date);
        if (i >= 0) personEntries[i] = entry;
        else personEntries.push(entry);
        entriesLoaded.add(pid);

        closePdaySheet();
        toast('সেভ হয়েছে', 'ok');
        rerenderCurrent(pid);
    });

    /* saving onto a day that already has a different entry would silently overwrite it */
    const clash = date !== original &&
        personEntries.some(e => e.personId === pid && e.date === date);
    if (clash) {
        askConfirm('এন্ট্রি বদলাবেন?',
            `${formatDateDMY(date)} তারিখে আগে থেকেই গিলার এন্ট্রি আছে। নতুনটি দিয়ে বদলে দেওয়া হবে।`,
            doSave, 'হ্যাঁ, বদলান');
        return;
    }
    doSave();
};

document.getElementById('pdayDelete').onclick = function () {
    const btn = this;
    const pid = editingPdayPersonId;
    const date = editingPdayOriginal;              // the stored entry, not whatever date is picked now
    if (!pid || !date) return;

    askConfirm('গিলা মুছবেন?', 'এই দিনের এন্ট্রি মুছে যাবে।', async () => {
        await withBusy(btn, async () => {
            await api.deleteEntry(pid, date);
            personEntries = personEntries.filter(e => !(e.personId === pid && e.date === date));
            closePdaySheet();
            toast('মুছে ফেলা হয়েছে', 'ok');
            rerenderCurrent(pid);
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

    const retry = ev.target.closest('[data-retry]');
    if (retry) {
        withBusy(retry, async () => {
            await refreshPersons();
            handleRoute();
        });
        return;
    }
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
   BOOT
   ============================================================ */
async function boot() {
    try {
        await refreshPersons();
    } catch (e) {
        loadError = e?.message || 'ডেটা লোড করা যায়নি';
        toast(loadError, 'err');
    }
    handleRoute();
}

boot();

/* ============================================================
   KEYBOARD, SEARCH
   ============================================================ */
/* Esc closes the top-most layer */
document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
        if (confirmEl.classList.contains('show')) document.getElementById('confirmNo').click();
        else if (pdaySheet.classList.contains('show')) closePdaySheet();
        else if (personSheet.classList.contains('show')) closePersonSheet();
        return;
    }

    /* Enter / Space on the div-based day rows (they have role="button") */
    const row = ev.target.closest?.('.pday-simple[data-open-pday]');
    if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); row.click(); return; }

    /* Enter inside a sheet field saves */
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
        if (personSheet.contains(ev.target)) document.getElementById('personSave').click();
        else if (pdaySheet.contains(ev.target)) document.getElementById('pdaySave').click();
    }
});

document.getElementById('personSearch')?.addEventListener('input', renderPersonList);