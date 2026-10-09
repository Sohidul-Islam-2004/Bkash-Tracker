/* ============================================================
   STATE
   ============================================================ */
const LS_PERSONS = 'elm_persons_v2';
const LS_PENTRIES = 'elm_person_entries_v2';

let persons = [];
let personEntries = [];
let currentRoute = '';

let editingPersonId = null;
let editingPdayPersonId = null;
let editingPdayDate = null;

let confirmCb = null;

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
const fmtDate = iso => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};

function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function getPerson(id) { return persons.find(p => p.id === id); }
function personEntriesFor(pid) { return personEntries.filter(e => e.personId === pid); }
function personTotalPieces(pid) {
    return personEntriesFor(pid).reduce((s, e) => s + (Number(e.pieces) || 0), 0);
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

/* ============================================================
   STORAGE
   ============================================================ */
function loadData() {
    try {
        persons = JSON.parse(localStorage.getItem(LS_PERSONS) || '[]') || [];
        personEntries = JSON.parse(localStorage.getItem(LS_PENTRIES) || '[]') || [];
        persons.forEach(p => {
            if (p.advance === undefined) p.advance = 0;
            if (p.price === undefined) p.price = 0;
        });
    } catch { persons = []; personEntries = []; }
}
function persistPersons() { localStorage.setItem(LS_PERSONS, JSON.stringify(persons)); }
function persistPersonEntries() { localStorage.setItem(LS_PENTRIES, JSON.stringify(personEntries)); }

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
   ICONS
   ============================================================ */
const ARROW_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
const PERSON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

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

function handleRoute() {
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
        renderPersonView(pid);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* home */
    viewHome.hidden = false;
    document.body.classList.remove('in-month');
    setTitle('ব্যক্তি হিসাব', 'গিলার হিসাব');
    renderHome();
    window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', handleRoute);

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
        const initial = (p.name || '?').trim().charAt(0);
        return `
            <article class="person-card">
                <button class="person-btn" data-open-person="${p.id}" type="button">
                    <span class="person-avatar"><span>${initial}</span></span>
                    <span class="person-info">
                        <span class="person-name">${p.name || 'নাম নেই'}</span>
                        <span class="person-meta">
                            <span>অগ্রিম ৳ ${bn(p.advance || 0)}</span>
                            <span class="meta-dot"></span>
                            <span>৳ ${bn(p.price || 0)}/গিলা</span>
                        </span>
                    </span>
                    <span class="person-total">
                        <div class="amt">${bn(pieces)}</div>
                        <div class="cnt">গিলা</div>
                    </span>
                    <span class="person-arrow">${ARROW_RIGHT}</span>
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
    const initial = (p.name || '?').trim().charAt(0);

    view.innerHTML = `
        <div class="person-view-hero">
            <div class="pvh-top">
                <div class="pvh-avatar">${initial}</div>
                <div class="pvh-title">
                    <h2>${p.name || 'নাম নেই'}</h2>
                    <p>অগ্রিম ৳ ${bn(p.advance || 0)} • ৳ ${bn(p.price || 0)}/গিলা</p>
                </div>
                <button class="icon-btn" data-edit-person="${pid}" type="button" aria-label="এডিট"
                    style="background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.28)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                    </svg>
                </button>
            </div>

            <div class="pvh-stats" style="grid-template-columns: 1fr;">
                <div class="pvh-stat">
                    <span class="pvh-stat-lbl">মোট গিলা</span>
                    <span class="pvh-stat-val">${bn(totalPieces)}</span>
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
                    <div class="pday-card">
                        <button class="pday-head" data-open-pday="${pid}|${date}" type="button">
                            <div class="pday-chip"><b>${+date.slice(8)}</b></div>
                            <div class="pday-info">
                                <div class="d1">${weekday(date)}</div>
                            </div>
                            <div class="pday-amt">
                                ${bn(d.pieces)} <small>গিলা</small>
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
        else renderPersonList();
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
        else renderPersonList();
    });
};

/* ============================================================
   PERSON DAY SHEET  (add / edit gila for a day)
   ============================================================ */
const pdaySheet = document.getElementById('pdaySheet');

function openPdaySheet(pid, date) {
    const p = getPerson(pid);
    if (!p) return;
    editingPdayPersonId = pid;
    editingPdayDate = date;

    const existing = personEntries.find(e => e.personId === pid && e.date === date);

    document.getElementById('pdayTitle').textContent = p.name;
    document.getElementById('pdaySub').textContent = 'আজ কত গিলা হয়েছে?';
    document.getElementById('pdayDate').value = date;
    document.getElementById('pdayPieces').value = existing ? existing.pieces : '';
    document.getElementById('pdayDelete').hidden = !existing;

    const hint = document.getElementById('pdayHint');
    hint.textContent = existing ? 'এই দিনের এন্ট্রি এডিট করছেন' : '';

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

/* cancel button for pday sheet */
document.getElementById('pdayCancel').onclick = closePdaySheet;

document.getElementById('pdaySave').onclick = () => {
    const pid = editingPdayPersonId;
    if (!pid) return;
    const date = document.getElementById('pdayDate').value;
    const pieces = parseNum(document.getElementById('pdayPieces').value);

    if (!date) return toast('তারিখ নির্বাচন করুন', 'err');
    if (pieces <= 0) return toast('গিলা লিখুন', 'err');

    const existing = personEntries.find(e => e.personId === pid && e.date === date);
    if (existing) existing.pieces = pieces;
    else personEntries.push({ id: uid('pe_'), personId: pid, date, pieces, createdAt: new Date().toISOString() });

    persistPersonEntries();
    toast('সেভ হয়েছে', 'ok');
    const savedDate = date;
    closePdaySheet();

    const ym = savedDate.slice(0, 7);
    if (currentRoute === `person/${pid}/month/${ym}`) renderPersonMonthView(pid, ym);
    else if (currentRoute === `person/${pid}`) renderPersonView(pid);
    else if (currentRoute === '') renderPersonList();
};

document.getElementById('pdayDelete').onclick = () => {
    const pid = editingPdayPersonId;
    const date = editingPdayDate;
    if (!pid || !date) return;
    askConfirm('গিলা মুছবেন?', 'এই দিনের এন্ট্রি মুছে যাবে।', () => {
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
   DATE
   ============================================================ */
function todayStr(d = new Date()) {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/* ============================================================
   BOOT
   ============================================================ */
loadData();
handleRoute();