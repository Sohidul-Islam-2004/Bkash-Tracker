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
const { esc: escHtml, num: bn, parseNum, monthName, weekday, todayStr, toast } = App;

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

async function updateDeposit(date, deposit) {
    const val = Number(deposit) || 0;
    const updated = await api(`/entries/by-date/${encodeURIComponent(date)}`, {
        method: 'PATCH',
        body: JSON.stringify({ deposit: val })
    });
    const rec = records.find(r => r.date === date);
    if (rec) {
        rec.deposit = val;
    } else if (updated && (updated.date || updated.data)) {
        records.push(updated.data || updated);
    }
}

async function removeByDate(date) {
    await api(`/entries/by-date/${encodeURIComponent(date)}`, { method: 'DELETE' });
    records = records.filter(r => r.date !== date);
    openDays.delete(date);
}

/* ============================================================
   NUMERAL HELPERS  —  DISPLAY IS ENGLISH
   ============================================================ */

const fmtNum = n => n.length === 11 ? n.slice(0, 5) + '-' + n.slice(5) : n;
const fmtDate = iso => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};

const fmtTime = () => {
    const d = new Date();
    return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
};

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
   SHEET
   ============================================================ */
const sheet = document.getElementById('sheet');
const sheetBg = document.getElementById('sheetBg');

function openSheet() {
    const today = todayStr();
    document.getElementById('date').value = today;
    document.getElementById('input').value = '';
    document.getElementById('joma').value = '';
    document.getElementById('previewBox').classList.remove('show');
    document.getElementById('fromField').hidden = true;
    fileMsgs = null;
    resetAck();
    updateSheetEjaaHint(today);
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
    let ejaa;
    if (all[date]) ejaa = all[date].ejaa;
    else {
        /* নতুন তারিখ: এর আগের শেষ দিনের পাওনাই ইজা */
        const before = Object.keys(all).filter(d => d < date).sort();
        ejaa = before.length ? all[before[before.length - 1]].pawna : InitialCarry;
    }
    const months = groupData();
    const day = months[date.slice(0, 7)] && months[date.slice(0, 7)].days[date];
    const dep = day ? day.deposit : 0;
    hint.textContent = `এই দিনের ইজা (আগের দিনের পাওনা): ৳ ${bn(ejaa)}` +
        (dep ? ` • এই দিনে আগে জমা সেভ আছে ৳ ${bn(dep)} — এখানে শুধু নতুন জমা লিখুন` : '');
}

/* ============================================================
   PASTE
   ============================================================ */
document.getElementById('pasteBtn').onclick = async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            document.getElementById('input').value = text;
            resetAck();
            toast('পেস্ট হয়েছে', 'ok');
        }
    } catch { toast('অনুমতি দেওয়া হয়নি', 'err'); }
};

/* ============================================================
   PREVIEW  (এন্ট্রি + ভুল + সতর্কতা)
   ============================================================ */
const previewBox = document.getElementById('previewBox');
const inputEl = document.getElementById('input');
const dateEl = document.getElementById('date');
const saveLabel = document.getElementById('saveLabel');
let ackSig = null;          // which set of warnings the user has already seen

function resetAck() {
    ackSig = null;
    if (saveLabel) saveLabel.textContent = 'সেভ করুন';
}
inputEl.addEventListener('input', resetAck);
dateEl.addEventListener('change', resetAck);

function runAnalysis() {
    return analyze(inputEl.value, dateEl.value, buildSavedIndex(records));
}

const boxStyle = (c, bg) =>
    `margin:8px 0;padding:10px;border:1px solid ${c};border-radius:10px;background:${bg};color:${c};font-size:13px;line-height:1.5`;
const lineHtml = t => t ? `<br><small dir="ltr" style="word-break:break-all;opacity:.85">${escHtml(t)}</small>` : '';

function analysisHtml(r) {
    let html = '';

    if (r.errors.length) {
        html += `<div style="${boxStyle('#e5484d', 'rgba(229,72,77,.08)')}">
            <b>⛔ ${r.errors.length} টি ভুল — ঠিক না করলে সেভ হবে না</b>
            ${r.errors.map(x => `<div style="margin-top:6px"><span dir="ltr" style="word-break:break-all">${escHtml(x.line)}</span><br><small>${escHtml(x.reason)}</small></div>`).join('')}
        </div>`;
    }
    if (r.reds.length) {
        html += `<div style="${boxStyle('#b45309', 'rgba(245,158,11,.10)')}">
            <b>⚠ ${r.reds.length} টি সতর্কতা — মিলিয়ে দেখুন</b>
            ${r.reds.map(x => `<div style="margin-top:6px">${escHtml(x.text)}${lineHtml(x.line)}</div>`).join('')}
        </div>`;
    }
    if (r.infos.length) {
        html += `<details style="${boxStyle('#475569', 'rgba(100,116,139,.08)')}">
            <summary style="cursor:pointer;font-weight:700">ℹ ${r.infos.length} টি তথ্য</summary>
            ${r.infos.map(x => `<div style="margin-top:6px">${escHtml(x.text)}${(x.list || []).map(l => lineHtml(l)).join('')}</div>`).join('')}
        </details>`;
    }
    if (r.entries.length) {
        const uniq = new Set(r.entries.map(e => e.number)).size;
        html += `
        <div class="preview-summary">
            <div class="preview-chip"><div class="n">${r.entries.length}</div><div class="l">এন্ট্রি</div></div>
            <div class="preview-chip"><div class="n">${uniq}</div><div class="l">ইউনিক</div></div>
            <div class="preview-chip"><div class="n">৳${bn(r.total)}</div><div class="l">মোট</div></div>
        </div>
        <div class="preview-list">
            ${[...r.entries].reverse().map(e => `
                <div class="preview-row">
                    <span class="num">${fmtNum(e.number)}</span>
                    <span class="amt">৳ ${bn(e.amount)}</span>
                </div>`).join('')}
        </div>`;
    }
    return html;
}

function showAnalysis(r) {
    const html = analysisHtml(r);
    previewBox.innerHTML = html;
    previewBox.classList.toggle('show', Boolean(html));
}

document.getElementById('previewBtn').onclick = () => {
    const r = runAnalysis();
    showAnalysis(r);
    if (r.errors.length) return toast(r.errors.length + ' টি ভুল আছে — ঠিক করুন', 'err');
    if (!r.entries.length) {
        return toast(r.skippedSaved ? 'সব এন্ট্রি আগেই সেভ আছে' : 'কোনো বৈধ এন্ট্রি পাওয়া যায়নি', 'err');
    }
    if (r.reds.length) toast(r.reds.length + ' টি সতর্কতা — মিলিয়ে দেখুন', 'err');
};

/* ============================================================
   CHAT FILE  (WhatsApp → Export chat → .txt)
   ------------------------------------------------------------
   শেষ সেভ হওয়া মেসেজের পর থেকে সব মেসেজ নিজে থেকেই আসে,
   তাই কোনো মেসেজ কপি করতে বাদ পড়ে না।
   ============================================================ */
const chatFile = document.getElementById('chatFile');
const fromField = document.getElementById('fromField');
const fromTs = document.getElementById('fromTs');
let fileMsgs = null;

const toLocalInput = d =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function fillFromFile() {
    if (!fileMsgs) return;
    const from = fromTs.value ? new Date(fromTs.value) : null;
    /* ফোনের তারিখ ভুল থাকলে কিছু মেসেজ ভবিষ্যতের তারিখে থাকে — সেগুলো নেওয়া হয় না */
    const until = new Date(Date.now() + 86400000);
    const future = fileMsgs.filter(m => m.ts && m.ts > until).length;
    const text = chatFileToText(fileMsgs, from, until);
    inputEl.value = text;
    resetAck();
    const n = text ? text.split('\n').filter(l => HDR_ISO.test(l)).length : 0;
    const note = future ? ` • ${future} টা মেসেজের তারিখ ভবিষ্যতের, বাদ` : '';
    if (!n) {
        previewBox.classList.remove('show');
        return toast('এই সময়ের পরে কোনো মেসেজ নেই' + note, 'err');
    }
    document.getElementById('previewBtn').click();
    toast(n + ' টা মেসেজ আনা হয়েছে' + note, 'ok');
}

document.getElementById('fileBtn').onclick = () => chatFile.click();
chatFile.onchange = async () => {
    const f = chatFile.files[0];
    if (!f) return;
    try {
        const chat = parseChat(await f.text(), dateEl.value);
        if (!chat.hasHeaders) return toast('এটা WhatsApp চ্যাট ফাইল (.txt) মনে হচ্ছে না', 'err');
        fileMsgs = chat.msgs;
        const start = latestSavedAt(records) || new Date((dateEl.value || todayStr()) + 'T00:00');
        fromTs.value = toLocalInput(start);
        fromField.hidden = false;
        fillFromFile();
    } catch (err) {
        console.error(err);
        toast('ফাইল পড়া যায়নি', 'err');
    } finally {
        chatFile.value = '';
    }
};
fromTs.addEventListener('change', fillFromFile);

/* ============================================================
   SAVE
   ============================================================ */
document.getElementById('saveBtn').onclick = async () => {
    const date = dateEl.value;
    const raw = inputEl.value.trim();
    const depositVal = parseNum(document.getElementById('joma').value);
    if (!date) return toast('তারিখ নির্বাচন করুন', 'err');

    const r = runAnalysis();
    showAnalysis(r);

    /* 1. ভুল থাকলে সেভ হবে না */
    if (r.errors.length) {
        return toast(r.errors.length + ' টি ভুল — ঠিক করে আবার সেভ করুন', 'err');
    }
    if (!r.entries.length) {
        return toast(r.skippedSaved ? 'সব এন্ট্রি আগেই সেভ আছে — নতুন কিছু নেই' : 'বৈধ এন্ট্রি পাওয়া যায়নি', 'err');
    }

    /* 2. সতর্কতা থাকলে একবার দেখিয়ে, দ্বিতীয়বার চাপলে সেভ */
    const sig = [date, raw.length, r.total, r.reds.map(x => x.text).join('#')].join('|');
    if (r.reds.length && ackSig !== sig) {
        ackSig = sig;
        if (saveLabel) saveLabel.textContent = 'দেখেছি — সেভ করুন';
        return toast(r.reds.length + ' টি সতর্কতা — মিলিয়ে দেখে আবার সেভ চাপুন', 'err');
    }

    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;

    try {
        await createRecord({
            date, raw,
            entries: r.entries,
            total: r.total,
            count: r.entries.length,
            deposit: depositVal
        });

        inputEl.value = '';
        document.getElementById('joma').value = '';
        previewBox.classList.remove('show');
        fileMsgs = null;
        fromField.hidden = true;
        resetAck();
        closeSheet();
        openDays.add(date);

        const ym = date.slice(0, 7);
        const wasOnSameMonth = currentRoute === `month/${ym}`;
        const wasOnSameDay = currentRoute === `day/${date}`;

        toast(`সেভ হয়েছে • ${r.entries.length} এন্ট্রি • জমা ৳${bn(depositVal)}`, 'ok');

        if (wasOnSameDay) {
            renderDayView(date);
        } else if (wasOnSameMonth) {
            renderMonthView(ym);
        } else {
            navigateTo(`day/${date}`);
        }
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

/* ============================================================
   GROUP DATA
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
            d.deposit += Number(r.deposit) || 0;      // একই দিনে একাধিক সেভ হলে জমা যোগ হয়
        });
    return months;
}

/* ============================================================
   COMPUTE ALL DAYS — carry previous pawna forward as ইজা
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

/* ---------- MONTH TOTALS ---------- */
function monthBkashTotal(ym, monthsInput) {
    const months = monthsInput || groupData();
    const m = months[ym];
    if (!m) return 0;
    const all = computeAllDays();
    let sum = 0;
    for (const date in m.days) {
        sum += all[date] ? all[date].bkash : m.days[date].total;
    }
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

    /* ---------- DAY ROUTE ---------- */
    if (hash.startsWith('day/')) {
        const date = hash.slice(4);
        console.log(date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { navigateTo(''); return; }
        viewHome.hidden = true;
        viewMonth.hidden = true;
        viewDay.hidden = false;
        document.body.classList.add('in-month');
        document.getElementById('topTitle').textContent = weekday(date);
        document.getElementById('topSub').textContent = fmtDate(date);
        renderDayView(date);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* ---------- MONTH ROUTE ---------- */
    if (hash.startsWith('month/')) {
        const ym = hash.slice(6);
        if (!/^\d{4}-\d{2}$/.test(ym)) { navigateTo(''); return; }
        viewHome.hidden = true;
        viewMonth.hidden = false;
        viewDay.hidden = true;
        document.body.classList.add('in-month');
        document.getElementById('topTitle').textContent = monthName(ym) + ' ' + ym.slice(0, 4);
        document.getElementById('topSub').textContent = 'মাসের বিস্তারিত';
        renderMonthView(ym);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    /* ---------- HOME ROUTE ---------- */
    viewHome.hidden = false;
    viewMonth.hidden = true;
    viewDay.hidden = true;
    document.body.classList.remove('in-month');
    document.getElementById('topTitle').textContent = 'সালাম ভাইয়ের লেনদেন';
    document.getElementById('topSub').textContent = 'প্রতিদিনের হিসাব';
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
   MONTH VIEW
   ============================================================ */
function renderMonthView(ym) {
    const months = groupData();
    const m = months[ym];

    const mh = document.getElementById('monthHero');
    const dayListEl = document.getElementById('dayList');
    const dayCountEl = document.getElementById('dayCount');
    const copyMonthBtn = document.getElementById('copyMonthBtn');

    if (!m) {
        if (copyMonthBtn) {
            copyMonthBtn.hidden = true;
            copyMonthBtn.dataset.month = '';
        }
        mh.style.display = 'none';
        dayListEl.innerHTML = `<div class="empty">
            <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
            <h3>এই মাসে কোনো এন্ট্রি নেই</h3>
            <p>+ বাটনে ক্লিক করে এন্ট্রি যোগ করুন</p>
        </div>`;
        dayCountEl.textContent = '0 দিন';
        return;
    }

    if (copyMonthBtn) {
        copyMonthBtn.hidden = false;
        copyMonthBtn.dataset.month = ym;
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

/* ============================================================
   RENDER DAY LIST ITEM  (month view — collapsed, tappable)
   ============================================================ */
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
   RENDER DAY VIEW  (own route — #/day/YYYY-MM-DD)
   ============================================================ */
function renderDayView(date) {
    const viewDay = document.getElementById('viewDay');
    if (!viewDay) return;

    const months = groupData();
    const m = months[date.slice(0, 7)];
    const d = m && m.days[date];

    /* ---------- no entry for this day ---------- */
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
        <!-- ===== HERO ===== -->
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

        <!-- ===== BODY ===== -->
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
        </div>
    `;
}

/* ============================================================
   DELEGATED CLICKS
   ============================================================ */
document.addEventListener('click', async ev => {

    /* --- copy all days of a month + grand total --- */
    const cpMonth = ev.target.closest('#copyMonthBtn');
    if (cpMonth) {
        ev.stopPropagation();
        const ym = cpMonth.dataset.month;
        if (!ym) return;

        const months = groupData();
        const m = months[ym];
        if (!m) return;

        const all = computeAllDays();
        const dates = Object.keys(m.days).sort(); // oldest → newest
        let grand = 0;

        const lines = dates.map(date => {
            const val = all[date] ? all[date].bkash : m.days[date].total;
            grand += val;
            return `${fmtDate(date)}  -  ${val}`;
        });

        const text =
            `${monthName(ym)} ${ym.slice(0, 4)}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            lines.join('\n') + '\n' +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `মোট বিকাশ  :  ${grand}\n`;

        cpMonth.classList.add('copied');
        setTimeout(() => cpMonth.classList.remove('copied'), 900);

        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
            .then(
                () => toast(dates.length + ' দিনের হিসাব কপি হয়েছে', 'ok'),
                () => toast('কপি ব্যর্থ', 'err')
            );
        return;
    }

    /* --- copy-all numbers + amounts for a day --- */
    const cpAll = ev.target.closest('[data-copy-all]');
    if (cpAll) {
        ev.stopPropagation();
        const date = cpAll.dataset.copyAll;
        const months = groupData();
        const m = months[date.slice(0, 7)];
        const d = m && m.days[date];
        if (!d || !d.entries.length) return;

        const { bkash, ejaa, deposit, total } = computeDay(date, d);
        const pawna = total - deposit;

        const arr = [...d.entries].reverse();
        const line = '-------------------------------';
        const sep = '━━━━━━━━━━━━━━━━━━━━';
        const row = (label, value) => `   ${label.padEnd(12)}: ${value}`;

        const text = [
            'সালাম ভাই,',
            '',
            `${fmtDate(date)} · ${fmtTime(date)}`,   // date + time on top
            `${arr.length} টি নম্বর`,
            line,
            '',
            ...[...arr].reverse().map(e => `${e.number} = ${e.amount}`),
            line,
            '',
            sep,
            row('বিকাশ', bkash),
            row('ইজা', ejaa),
            '   ──────────────',
            row('টোটাল', total),
            row('জমা', deposit),
            '   ──────────────',
            row('হাসান পাওনা', pawna),
            sep
        ].join('\n');

        cpAll.classList.add('copied');
        setTimeout(() => cpAll.classList.remove('copied'), 900);

        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
            .then(
                () => toast(d.entries.length + ' টি নম্বর ও টাকা কপি হয়েছে', 'ok'),
                () => toast('কপি ব্যর্থ', 'err')
            );
        return;
    }

    /* --- copy-all summary values for a day --- */
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

        const sep = '━━━━━━━━━━━━━━━━━━━━';
        const row = (label, value) => `   ${label.padEnd(12)}: ${value}`;

        const text = [
            ` ${fmtDate(date)}`,
            sep,
            row('বিকাশ', bkash),
            row('ইজা', ejaa),
            '   ──────────────',
            row('টোটাল', total),
            row('জমা', deposit),
            '   ──────────────',
            row('হাসান পাওনা', pawna),
            sep
        ].join('\n');

        cpSum.classList.add('copied');
        setTimeout(() => cpSum.classList.remove('copied'), 900);

        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
            .then(
                () => toast('হিসাব কপি হয়েছে', 'ok'),
                () => toast('কপি ব্যর্থ', 'err')
            );
        return;
    }

    /* --- open month --- */
    const openMonthBtn = ev.target.closest('[data-open-month]');
    if (openMonthBtn) {
        navigateTo('month/' + openMonthBtn.dataset.openMonth);
        return;
    }

    /* --- open day --- */
    const td = ev.target.closest('[data-td]');
    if (td) {
        navigateTo('day/' + td.dataset.td);
        return;
    }

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
            .then(
                () => toast('নম্বর ও টাকা কপি হয়েছে', 'ok'),
                () => toast(num)
            );
    }
});

/* ============================================================
   BACK BUTTON
   ------------------------------------------------------------
   day/*   → back to its month
   month/* → back to home
   home   → browser back
   ============================================================ */
document.getElementById('backBtn').onclick = () => {
    if (currentRoute.startsWith('day/')) {
        navigateTo('month/' + currentRoute.slice(4, 11));
    } else if (currentRoute.startsWith('month/')) {
        navigateTo('');
    } else {
        window.location.replace('/');
    }
};

/* ============================================================
   BOOT
   ============================================================ */
(async function init() {
    await fetchRecords();
    handleRoute();
})();
