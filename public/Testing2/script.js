/* ============================================================
   হিসাব — simple ledger + optional bKash / WhatsApp
   Storage: localStorage (no backend needed)
   Person = name + optional bKash + optional WhatsApp.
   Balance = মোট রিসিভ − মোট সেন্ড   (computed from transactions)
   ============================================================ */

/* ============================================================
   STORAGE
   ============================================================ */
const STORAGE_KEY = "hisab_db_v1";

function loadDB() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { people: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.people)) return { people: [] };
        return parsed;
    } catch (_) {
        return { people: [] };
    }
}

function saveDB() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
        toast("সেভ করা যায়নি (স্টোরেজ পূর্ণ?)", "error");
    }
}

/* ============================================================
   STATE
   ============================================================ */
let db = loadDB();
let currentView = "viewDashboard";
let currentPersonId = null;

/* ============================================================
   DATA LAYER — replaces the old API calls
   ============================================================ */
function getAllPeople() {
    return db.people;
}

function getPerson(id) {
    return db.people.find((p) => p.id === id) || null;
}

function createPerson({ name, bkashNumber = "", whatsappNumber = "" }) {
    const person = {
        id: uid(),
        name,
        bkashNumber,
        whatsappNumber,
        transactions: [],
        createdAt: new Date().toISOString(),
    };
    db.people.push(person);
    saveDB();
    return person;
}

function addTransaction(personId, { type, amount, date, counterparty = null, notes = null }) {
    const p = getPerson(personId);
    if (!p) throw new Error("person not found");
    const txn = {
        id: uid(),
        type,
        amount: Number(amount),
        date: date || new Date().toISOString(),
        counterparty,
        notes,
    };
    p.transactions = p.transactions || [];
    p.transactions.push(txn);
    saveDB();
    return txn;
}

function deleteTransaction(personId, txnId) {
    const p = getPerson(personId);
    if (!p) throw new Error("person not found");
    const before = (p.transactions || []).length;
    p.transactions = (p.transactions || []).filter((t) => t.id !== txnId);
    if (p.transactions.length === before) throw new Error("Transaction not found");
    saveDB();
}

/* ============================================================
   LEDGER MATH
   ============================================================ */
function totalsOf(p) {
    let sent = 0;
    let received = 0;
    (p.transactions || []).forEach((t) => {
        const a = Number(t.amount || 0);
        if (t.type === "send") sent += a;
        else received += a;
    });
    return { sent, received, balance: received - sent };
}

/* ============================================================
   ERROR TRANSLATION
   ============================================================ */
function translateError(msg) {
    if (!msg) return "অজানা সমস্যা";
    const text = String(msg);
    const map = {
        "amount must be > 0": "টাকার পরিমাণ লিখুন",
        "Amount must be more than 0": "টাকার পরিমাণ লিখুন",
        "type must be send or receive": "ধরন ঠিক নয়",
        "Invalid transaction type": "ধরন ঠিক নয়",
        "person not found": "মানুষ খুঁজে পাওয়া যায়নি",
        "Person not found": "মানুষ খুঁজে পাওয়া যায়নি",
        "Invalid id": "ভুল আইডি",
        "Transaction not found": "লেনদেন খুঁজে পাওয়া যায়নি",
    };
    for (const k in map) if (text.includes(k)) return map[k];
    return text;
}

/* ============================================================
   SMALL HELPERS
   ============================================================ */
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg, kind) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className =
        "toast show" +
        (kind === "error" ? " error" : kind === "success" ? " success" : "");
    clearTimeout(t._t);
    t._t = setTimeout(() => {
        t.className = "toast";
    }, 2400);
}

function money(n) {
    const num = Number(n || 0);
    const sign = num < 0 ? "-" : "";
    return (
        sign +
        "৳" +
        Math.abs(num).toLocaleString("en-IN", { maximumFractionDigits: 0 })
    );
}

function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function initialsOf(n) {
    return (n || "?")
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
}

function avatarHTML(person, sizeClass) {
    return `<div class="avatar ${sizeClass}">${esc(initialsOf(person.name))}</div>`;
}

function balClass(b) {
    return b > 0 ? "pos" : b < 0 ? "neg" : "zero";
}

/* ============================================================
   PAGE ROUTING
   ============================================================ */
function show(id) {
    currentView = id;
    ["viewDashboard", "viewAddPerson", "viewPerson"].forEach((v) =>
        document.getElementById(v).classList.toggle("hidden", v !== id)
    );
    window.scrollTo(0, 0);
}

function showDashboard() {
    currentPersonId = null;
    renderDashboard();
    show("viewDashboard");
}

function showAddPerson() {
    const f = document.querySelector("#viewAddPerson form");
    if (f) f.reset();
    show("viewAddPerson");
}

function showPerson(id) {
    const p = getPerson(id);
    if (!p) {
        toast("মানুষ খুঁজে পাওয়া যায়নি", "error");
        return;
    }
    currentPersonId = id;
    renderPerson(id);
    show("viewPerson");
}

/* ============================================================
   LOGO
   ============================================================ */
const DEFAULT_LOGO =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff4a7d"/>
      <stop offset="1" stop-color="#a51845"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="18" fill="url(#g)"/>
  <text x="32" y="44" font-family="Arial,sans-serif" font-size="32"
        font-weight="700" fill="#fff" text-anchor="middle">৳</text>
</svg>`
    );

function renderLogo() {
    document.getElementById("brandLogo").src = DEFAULT_LOGO;
}

/* ============================================================
   MODALS
   ============================================================ */
function showModal({
    title,
    description = "",
    fields,
    submitLabel = "ঠিক আছে",
    cancelLabel = "বাতিল",
}) {
    return new Promise((resolve) => {
        const modalId = "m" + uid();
        const fieldsHtml = fields
            .map(
                (f) => `
            <div class="field">
                <label>${esc(f.label)}</label>
                <input id="${modalId}_${f.id}"
                       type="${f.type || "text"}"
                       value="${esc(f.value ?? "")}"
                       placeholder="${esc(f.placeholder || "")}"
                       inputmode="${f.inputmode || "text"}" />
            </div>`
            )
            .join("");

        document.getElementById("modalRoot").innerHTML = `
            <div class="modal-bg" id="${modalId}_bg">
                <div class="modal">
                    <h3>${title}</h3>
                    ${description ? `<div class="modal-sub">${description}</div>` : ""}
                    ${fieldsHtml}
                    <div class="modal-actions">
                        <button class="btn btn-light" id="${modalId}_cancel">${cancelLabel}</button>
                        <button class="btn btn-primary" id="${modalId}_ok">${submitLabel}</button>
                    </div>
                </div>
            </div>`;

        const bg = document.getElementById(`${modalId}_bg`);
        const cleanup = (result) => {
            document.getElementById("modalRoot").innerHTML = "";
            resolve(result);
        };

        bg.addEventListener("click", (e) => {
            if (e.target === bg) cleanup(null);
        });
        document.getElementById(`${modalId}_cancel`).onclick = () => cleanup(null);
        document.getElementById(`${modalId}_ok`).onclick = () => {
            const result = {};
            for (const f of fields) {
                result[f.id] = document.getElementById(`${modalId}_${f.id}`).value;
            }
            cleanup(result);
        };

        setTimeout(() => {
            if (fields[0]) document.getElementById(`${modalId}_${fields[0].id}`).focus();
        }, 60);
    });
}

function confirmModal({
    title,
    description,
    submitLabel = "হ্যাঁ",
    cancelLabel = "না",
}) {
    return new Promise((resolve) => {
        const modalId = "m" + uid();
        document.getElementById("modalRoot").innerHTML = `
            <div class="modal-bg" id="${modalId}_bg">
                <div class="modal">
                    <h3>${title}</h3>
                    ${description ? `<div class="modal-sub">${description}</div>` : ""}
                    <div class="modal-actions">
                        <button class="btn btn-light" id="${modalId}_cancel">${cancelLabel}</button>
                        <button class="btn btn-primary" id="${modalId}_ok">${submitLabel}</button>
                    </div>
                </div>
            </div>`;

        const bg = document.getElementById(`${modalId}_bg`);
        const cleanup = (result) => {
            document.getElementById("modalRoot").innerHTML = "";
            resolve(result);
        };
        bg.addEventListener("click", (e) => {
            if (e.target === bg) cleanup(false);
        });
        document.getElementById(`${modalId}_cancel`).onclick = () => cleanup(false);
        document.getElementById(`${modalId}_ok`).onclick = () => cleanup(true);
    });
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
    const grid = document.getElementById("peopleGrid");
    const sb = document.getElementById("searchBar");
    if (sb) sb.classList.toggle("solo", db.people.length === 0);

    if (db.people.length === 0) {
        grid.innerHTML = `
            <div class="empty" style="grid-column:1/-1">
                <div class="icon">📋</div>
                <h3>এখনো কেউ যোগ করা হয়নি</h3>
                <p>হিসাব শুরু করতে উপরের "যোগ" বাটনে চাপ দিন।</p>
            </div>`;
        return;
    }

    const box = document.getElementById("searchBox");
    const q = box ? box.value.trim().toLowerCase() : "";
    const list = q
        ? db.people.filter((p) => (p.name || "").toLowerCase().includes(q))
        : db.people;

    if (list.length === 0) {
        grid.innerHTML = `
            <div class="empty" style="grid-column:1/-1">
                <div class="icon">🔍</div>
                <h3>কাউকে পাওয়া যায়নি</h3>
                <p>অন্য নাম লিখে দেখুন।</p>
            </div>`;
        return;
    }

    grid.innerHTML = list
        .map((p, i) => {
            const t = totalsOf(p);
            return `
        <div class="person-card" style="animation-delay:${Math.min(i, 8) * 40}ms">
            <div class="pc-head" onclick="showPerson('${p.id}')">
                ${avatarHTML(p, "avatar-sm")}
                <div class="pc-info">
                    <h3>${esc(p.name)}</h3>
                    <div class="pc-num">${(p.transactions || []).length} টি লেনদেন</div>
                </div>
                <div class="pc-bal bal-${balClass(t.balance)}">${money(t.balance)}</div>
            </div>

            <div class="pc-actions">
                <button class="pc-btn pc-send" onclick="event.stopPropagation();quickTxn('${p.id}','send')">
                    <span class="pc-btn-arrow">↓</span> সেন্ড
                </button>
                <button class="pc-btn pc-receive" onclick="event.stopPropagation();quickTxn('${p.id}','receive')">
                    <span class="pc-btn-arrow">↑</span> রিসিভ
                </button>
            </div>
        </div>`;
        })
        .join("");
}

/* ============================================================
   ADD SEND / RECEIVE  (dashboard card + person ledger)
   ============================================================ */
async function quickTxn(id, type) {
    const p = getPerson(id);
    if (!p) return;
    const isSend = type === "send";
    const t = totalsOf(p);

    const result = await showModal({
        title: isSend ? "↓ সেন্ড" : "↑ রিসিভ",
        description: `<b>${esc(p.name)}</b> · এখন ${money(t.balance)}`,
        fields: [
            {
                id: "amount",
                label: "কত টাকা?",
                type: "number",
                inputmode: "numeric",
                value: "",
            },
        ],
        submitLabel: "✔ যোগ করুন",
    });
    if (!result) return;

    const amount = Number(result.amount);
    if (!amount || amount <= 0) return toast("টাকার পরিমাণ লিখুন", "error");

    try {
        addTransaction(id, {
            type,
            amount,
            date: new Date().toISOString(),
            counterparty: null,
            notes: null,
        });
        toast("যোগ হয়েছে ✔", "success");
        if (currentView === "viewPerson") renderPerson(id);
        else renderDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   PERSON DETAIL — LEDGER
   ============================================================ */
function renderPerson(id) {
    const p = getPerson(id);
    if (!p) {
        showDashboard();
        return;
    }

    const t = totalsOf(p);
    const txns = [...(p.transactions || [])].sort(
        (a, b) => new Date(b.date) - new Date(a.date)
    );

    const rowsHtml = txns.length
        ? txns
            .map((tx) => {
                const d = new Date(tx.date);
                const dateStr = d.toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "numeric",
                    year: "2-digit",
                });
                const timeStr = d.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                });
                const isSend = tx.type === "send";
                return `
            <div class="lg-row">
                <div class="lg-main">
                    <div class="lg-note">${isSend ? "সেন্ড" : "রিসিভ"}</div>
                    <div class="lg-date">${dateStr} · ${timeStr}</div>
                </div>
                <div class="lg-col ${isSend ? "lg-out" : "lg-in"}">${isSend ? "-" : "+"}${money(tx.amount)}</div>
                <button class="tx-del" onclick="deleteTxn('${p.id}','${tx.id}')" aria-label="মুছুন">✕</button>
            </div>`;
            })
            .join("")
        : `<div class="empty" style="padding:40px 20px">
               <div class="icon">📭</div>
               <p>এখনো কোনো লেনদেন নেই।</p>
           </div>`;

    document.getElementById("personDetail").innerHTML = `
        <div class="panel">
            <div class="person-header">
                ${avatarHTML(p, "avatar-lg")}
                <div class="person-header-info">
                    <h2 class="person-header-name">${esc(p.name)}</h2>
                    <div class="lg-big bal-${balClass(t.balance)}">${money(t.balance)}</div>
                    ${p.bkashNumber
            ? `<div class="lg-date" style="margin-top:6px">বিকাশ: ${esc(p.bkashNumber)}</div>`
            : ""
        }
                </div>
            </div>

            <div class="pc-actions" style="margin-top:16px">
                <button class="pc-btn pc-send" onclick="quickTxn('${p.id}','send')">
                    <span class="pc-btn-arrow">↓</span> সেন্ড
                </button>
                <button class="pc-btn pc-receive" onclick="quickTxn('${p.id}','receive')">
                    <span class="pc-btn-arrow">↑</span> রিসিভ
                </button>
                ${p.whatsappNumber
            ? `<button class="pc-btn pc-wa" onclick="waRequest('${p.id}')">
                               📱 হোয়াটসঅ্যাপে চান
                           </button>`
            : ""
        }
            </div>
        </div>

        <div class="panel lg-panel">
            <h3 class="section-label" style="margin-top:0">📜 হিসাব (${txns.length})</h3>
            ${rowsHtml}
        </div>
    `;
}

/* ============================================================
   WHATSAPP REQUEST
   ============================================================ */
function waRequest(id) {
    const p = getPerson(id);
    if (!p || !p.whatsappNumber) return;
    const t = totalsOf(p);
    const msg = `আপনার বিকাশ নম্বর (${p.bkashNumber || "-"}) থেকে ${money(
        Math.abs(t.balance) || 0
    )} টাকা পাঠান।`;
    let num = p.whatsappNumber.replace(/\D/g, "");
    if (num.startsWith("01") && num.length === 11) num = "88" + num;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
}

/* ============================================================
   DELETE TRANSACTION
   ============================================================ */
async function deleteTxn(personId, txnId) {
    const ok = await confirmModal({
        title: "মুছে ফেলবেন?",
        description: "এই লেনদেনটি চিরতরে মুছে যাবে।",
        submitLabel: "হ্যাঁ, মুছুন",
    });
    if (!ok) return;

    try {
        deleteTransaction(personId, txnId);
        toast("মুছে ফেলা হয়েছে");
        if (currentView === "viewPerson") renderPerson(personId);
        else renderDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   SUBMIT PERSON  (name + optional amount/bKash/WhatsApp)
   ============================================================ */
function submitPerson(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    const amount = Number(f.get("amount")) || 0;
    const bkashNumber = String(f.get("bkashNumber") || "").replace(/\D/g, "");
    const whatsappNumber = String(f.get("whatsappNumber") || "").replace(/\D/g, "");
    if (!name) return toast("নাম লিখুন", "error");

    try {
        const p = createPerson({ name, bkashNumber, whatsappNumber });

        /* Starting amount becomes the first ledger entry (রিসিভ) */
        if (amount > 0) {
            addTransaction(p.id, {
                type: "receive",
                amount,
                date: new Date().toISOString(),
                counterparty: null,
                notes: null,
            });
        }

        e.target.reset();
        toast("যোগ হয়েছে ✔", "success");
        showDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   DISABLE ZOOM + COPY
   ============================================================ */
document.addEventListener(
    "wheel",
    (e) => {
        if (e.ctrlKey || e.metaKey) e.preventDefault();
    },
    { passive: false }
);
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());
document.addEventListener("gestureend", (e) => e.preventDefault());
document.addEventListener(
    "touchstart",
    (e) => {
        if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false }
);
document.addEventListener(
    "touchmove",
    (e) => {
        if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false }
);
document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const isEditable =
        tag === "input" || tag === "textarea" || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && !isEditable) {
        const k = e.key.toLowerCase();
        if (["c", "a", "x", "s", "u"].includes(k)) e.preventDefault();
    }
});
document.addEventListener("contextmenu", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    e.preventDefault();
});
let lastTouchEnd = 0;
document.addEventListener(
    "touchend",
    (e) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) e.preventDefault();
        lastTouchEnd = now;
    },
    { passive: false }
);

/* ============================================================
   INIT
   ============================================================ */
document.getElementById("backBtn").onclick = () => {
    if (currentView === "viewAddPerson" || currentView === "viewPerson") {
        showDashboard();
        return;
    }
    window.location.href = "/";
};

renderLogo();
showDashboard();