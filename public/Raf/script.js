/* ============================================================
   লেনদেন হিসাব — simple ledger
   Person = name + amount.  Inside a person: সেন্ড / রিসিভ ledger.
   Balance = মোট রিসিভ − মোট সেন্ড   (computed from transactions)
   ============================================================ */

/* ============================================================
   STATE
   ============================================================ */
let db = { people: [] };
let currentView = "viewDashboard";
let currentPersonId = null;

/* ============================================================
   API HELPERS
   ============================================================ */
async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || "Server error");
    return data;
}

async function apiForm(path, { method = "POST", formData } = {}) {
    const res = await fetch(path, { method, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || "Server error");
    return data;
}

/* ============================================================
   NORMALIZE (_id → id) + LEDGER MATH
   ============================================================ */
function normalizePerson(p) {
    return {
        ...p,
        id: p._id || p.id,
        transactions: (p.transactions || []).map((t) => ({
            ...t,
            id: t._id || t.id,
        })),
    };
}

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

/* Load every person WITH transactions so balances are always exact */
async function refreshPeople() {
    const list = await api("/api/people");
    db.people = await Promise.all(
        list.map(async (item) => {
            const np = normalizePerson(item);
            if (Array.isArray(item.transactions)) return np;
            try {
                return normalizePerson(await api("/api/people/" + np.id));
            } catch (_) {
                return np;
            }
        })
    );
}

async function refreshPerson(id) {
    const np = normalizePerson(await api("/api/people/" + id));
    const idx = db.people.findIndex((x) => x.id === id);
    if (idx >= 0) db.people[idx] = np;
    else db.people.push(np);
    return np;
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
        "exceeds daily limit": "আজকের সীমা পার হয়ে যাবে",
        "exceeds monthly limit": "এই মাসের সীমা পার হয়ে যাবে",
        "not enough balance": "ব্যালেন্স নেই",
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

async function showDashboard() {
    currentPersonId = null;
    try {
        await refreshPeople();
    } catch (e) {
        toast("সার্ভারে সংযোগ হয়নি", "error");
    }
    renderDashboard();
    show("viewDashboard");
}

function showAddPerson() {
    const f = document.querySelector("#viewAddPerson form");
    if (f) f.reset();
    show("viewAddPerson");
}

async function showPerson(id) {
    try {
        await refreshPerson(id);
    } catch (e) {
        toast("লোড হয়নি: " + translateError(e.message), "error");
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
function renderTotals() {
    const total = db.people.reduce((s, p) => s + totalsOf(p).balance, 0);
    document.getElementById("totalPeople").textContent = db.people.length;
    const el = document.getElementById("totalBalance");
    el.textContent = money(total);
    el.className = "bal-" + balClass(total);
}

function renderDashboard() {
    renderTotals();
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
                <button class="pc-btn pc-send" onclick="quickTxn('${p.id}','send')">
                    <span class="pc-btn-arrow">↓</span> সেন্ড
                </button>
                <button class="pc-btn pc-receive" onclick="quickTxn('${p.id}','receive')">
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
    const p = db.people.find((x) => x.id === id);
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
            {
                id: "notes",
                label: "বিবরণ (না দিলেও চলবে)",
                value: "",
            },
        ],
        submitLabel: "✔ যোগ করুন",
    });
    if (!result) return;

    const amount = Number(result.amount);
    if (!amount || amount <= 0) return toast("টাকার পরিমাণ লিখুন", "error");

    try {
        await api(`/api/transactions/${id}`, {
            method: "POST",
            body: {
                type,
                amount,
                date: new Date().toISOString(),
                counterparty: null,
                notes: (result.notes || "").trim() || null,
            },
        });
        await refreshPerson(id);
        toast("যোগ হয়েছে ✔", "success");
        if (currentView === "viewPerson") renderPerson(id);
        else renderDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   PERSON DETAIL — LEDGER (লেনদেন হিসাব)
   ============================================================ */
function renderPerson(id) {
    const p = db.people.find((x) => x.id === id);
    if (!p) {
        showDashboard();
        return;
    }

    const t = totalsOf(p);

    /* oldest → newest to build the running balance */
    const asc = [...(p.transactions || [])].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
    );
    let run = 0;
    const rows = asc.map((tx) => {
        const a = Number(tx.amount || 0);
        run += tx.type === "send" ? -a : a;
        return { tx, running: run };
    });
    rows.reverse(); /* show newest first */

    const rowsHtml = rows.length
        ? rows
            .map(({ tx, running }) => {
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
                const label = tx.notes ? esc(tx.notes) : isSend ? "সেন্ড" : "রিসিভ";
                return `
            <div class="lg-row">
                <div class="lg-main">
                    <div class="lg-note">${label}</div>
                    <div class="lg-date">${dateStr} · ${timeStr}</div>
                </div>
                <div class="lg-col lg-out">${isSend ? money(tx.amount) : ""}</div>
                <div class="lg-col lg-in">${!isSend ? money(tx.amount) : ""}</div>
                <div class="lg-col lg-run bal-${balClass(running)}">${money(running)}</div>
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
                </div>
            </div>

            <div class="lg-totals">
                <div class="lg-total lg-total-in">
                    <span>মোট রিসিভ</span><b>${money(t.received)}</b>
                </div>
                <div class="lg-total lg-total-out">
                    <span>মোট সেন্ড</span><b>${money(t.sent)}</b>
                </div>
            </div>

            <div class="pc-actions" style="margin-top:14px">
                <button class="pc-btn pc-send" onclick="quickTxn('${p.id}','send')">
                    <span class="pc-btn-arrow">↓</span> সেন্ড
                </button>
                <button class="pc-btn pc-receive" onclick="quickTxn('${p.id}','receive')">
                    <span class="pc-btn-arrow">↑</span> রিসিভ
                </button>
            </div>

            <div class="lg-tools">
                <button class="btn btn-light" onclick="renamePerson('${p.id}')">✏️ নাম বদলান</button>
                <button class="btn btn-danger" onclick="deletePerson('${p.id}')">🗑 মুছুন</button>
            </div>
        </div>

        <div class="panel lg-panel">
            <h3 class="section-label" style="margin-top:0">📜 লেনদেন হিসাব (${rows.length})</h3>
            <div class="lg-scroll">
                <div class="lg-row lg-headrow">
                    <div class="lg-main">বিবরণ</div>
                    <div class="lg-col">সেন্ড</div>
                    <div class="lg-col">রিসিভ</div>
                    <div class="lg-col">ব্যালেন্স</div>
                    <span class="tx-del-spacer"></span>
                </div>
                ${rowsHtml}
            </div>
        </div>
    `;
}

/* ============================================================
   SUBMIT PERSON  (name + amount only)
   ============================================================ */
async function submitPerson(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    const amount = Number(f.get("amount")) || 0;
    if (!name) return toast("নাম লিখুন", "error");

    const fd = new FormData();
    fd.append("name", name);
    fd.append("bkashNumber", "");
    fd.append("whatsappNumber", "");
    fd.append("initialBalance", 0);
    fd.append("dailyUsedBase", 0);
    fd.append("monthlyUsedBase", 0);

    try {
        const created = await apiForm("/api/people", { formData: fd });
        const newId = created._id || created.id;

        /* starting amount becomes the first ledger entry (রিসিভ) */
        if (amount > 0 && newId) {
            await api(`/api/transactions/${newId}`, {
                method: "POST",
                body: {
                    type: "receive",
                    amount,
                    date: new Date().toISOString(),
                    counterparty: null,
                    notes: "শুরুর টাকা",
                },
            });
        }

        e.target.reset();
        toast("যোগ হয়েছে ✔", "success");
        await showDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   RENAME / DELETE
   ============================================================ */
async function renamePerson(id) {
    const p = db.people.find((x) => x.id === id);
    if (!p) return;

    const result = await showModal({
        title: "নাম বদলান",
        fields: [{ id: "name", label: "নাম", value: p.name }],
        submitLabel: "✔ সংরক্ষণ",
    });
    if (!result) return;

    const name = (result.name || "").trim();
    if (!name) return toast("নাম লিখুন", "error");

    try {
        await api("/api/people/" + id, { method: "PATCH", body: { name } });
        await refreshPerson(id);
        toast("সংরক্ষণ হয়েছে ✔", "success");
        renderPerson(id);
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

async function deleteTxn(personId, txnId) {
    const ok = await confirmModal({
        title: "মুছে ফেলবেন?",
        description: "এই লেনদেনটি মুছে গেলে ব্যালেন্স আবার হিসাব হবে।",
        submitLabel: "হ্যাঁ, মুছুন",
    });
    if (!ok) return;

    try {
        await api("/api/transactions/" + txnId, { method: "DELETE" });
        await refreshPerson(personId);
        toast("মুছে ফেলা হয়েছে");
        renderPerson(personId);
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

async function deletePerson(id) {
    const p = db.people.find((x) => x.id === id);
    if (!p) return;

    const ok = await confirmModal({
        title: `${esc(p.name)} কে মুছবেন?`,
        description: "এই মানুষের সব লেনদেনও মুছে যাবে।",
        submitLabel: "হ্যাঁ, মুছুন",
    });
    if (!ok) return;

    try {
        await api("/api/people/" + id, { method: "DELETE" });
        toast("মুছে ফেলা হয়েছে");
        await showDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   DISABLE ZOOM + COPY  (kept from your original)
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
