/* ============================================================
   হিসাব — simple ledger + optional bKash / WhatsApp
   Storage: localStorage. No backend.

   Convention (পাওনা-focused):
     "send"    = আমি বাকি দিয়েছি (I gave / they owe me)
     "receive" = আমি টাকা পেয়েছি (I received money back)
     net = totalGiven − totalReceived
     net > 0  → "পাব"  (they owe me)   → green
     net < 0  → "দেব"  (I owe them)    → red   (edge case)
     net = 0  → "সমান"
   ============================================================ */

const STORAGE_KEY = "hisab_db_v2";

/* ============================================================
   STORAGE
   ============================================================ */
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
   DATA LAYER
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

function addTransaction(personId, { type, amount, date, notes = null }) {
    const p = getPerson(personId);
    if (!p) throw new Error("person not found");
    const txn = {
        id: uid(),
        type,
        amount: Number(amount),
        date: date || new Date().toISOString(),
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
    const idx = (p.transactions || []).findIndex((t) => t.id === txnId);
    if (idx < 0) throw new Error("Transaction not found");
    const [removed] = p.transactions.splice(idx, 1);
    saveDB();
    return removed;
}

function restoreTransaction(personId, txn) {
    const p = getPerson(personId);
    if (!p || !txn) return;
    p.transactions = p.transactions || [];
    p.transactions.push(txn);
    saveDB();
}

/* ============================================================
   LEDGER MATH
   ============================================================ */
function totalsOf(p) {
    let given = 0;   // বাকি দিয়েছি
    let got = 0;     // টাকা পেয়েছি
    (p.transactions || []).forEach((t) => {
        const a = Number(t.amount || 0);
        if (t.type === "send") given += a;
        else got += a;
    });
    return { given, got, net: given - got };
}

/* ============================================================
   HELPERS
   ============================================================ */
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

function balClass(net) {
    return net > 0 ? "pos" : net < 0 ? "neg" : "zero";
}

function balLabel(net) {
    if (net > 0) return "পাব";
    if (net < 0) return "দেব";
    return "সমান";
}

function fmtDate(iso) {
    const d = new Date(iso);
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
    return `${dateStr} · ${timeStr}`;
}

/* ============================================================
   TOAST  (with optional action button for undo)
   ============================================================ */
let toastTimer = null;

function toast(msg, kind, opts = {}) {
    const t = document.getElementById("toast");
    t.innerHTML = "";

    const text = document.createElement("span");
    text.textContent = msg;
    t.appendChild(text);

    if (opts.actionLabel && typeof opts.onAction === "function") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toast-action";
        btn.textContent = opts.actionLabel;
        btn.onclick = () => {
            hideToast();
            opts.onAction();
        };
        t.appendChild(btn);
    }

    t.className =
        "toast show" +
        (kind === "error" ? " error" : kind === "success" ? " success" : "");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(
        hideToast,
        opts.duration || (opts.actionLabel ? 4500 : 2400)
    );
}

function hideToast() {
    const t = document.getElementById("toast");
    t.className = "toast";
    clearTimeout(toastTimer);
}

/* ============================================================
   MODALS
   ============================================================ */
function confirmModal({
    title,
    description = "",
    submitLabel = "হ্যাঁ",
    cancelLabel = "না",
    danger = false,
}) {
    return new Promise((resolve) => {
        const id = "m" + uid();
        const root = document.getElementById("modalRoot");

        root.innerHTML = `
            <div class="modal-bg" id="${id}_bg">
                <div class="modal">
                    <h3>${esc(title)}</h3>
                    ${description
                ? `<div class="modal-sub">${description}</div>`
                : ""
            }
                    <div class="modal-actions">
                        <button class="btn btn-light" id="${id}_cancel">${esc(
                cancelLabel
            )}</button>
                        <button class="btn ${danger ? "btn-danger" : "btn-primary"
            }" id="${id}_ok">${esc(submitLabel)}</button>
                    </div>
                </div>
            </div>`;

        const cleanup = (r) => {
            root.innerHTML = "";
            resolve(r);
        };

        document.getElementById(`${id}_bg`).addEventListener("click", (e) => {
            if (e.target.id === `${id}_bg`) cleanup(false);
        });
        document.getElementById(`${id}_cancel`).onclick = () => cleanup(false);
        document.getElementById(`${id}_ok`).onclick = () => cleanup(true);
    });
}

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

function askAmount({ title, description = "" }) {
    return new Promise((resolve) => {
        const id = "m" + uid();
        const root = document.getElementById("modalRoot");

        const chipsHtml = QUICK_AMOUNTS.map(
            (v) =>
                `<button type="button" class="amount-chip" data-amount="${v}">${v.toLocaleString(
                    "en-IN"
                )}</button>`
        ).join("");

        root.innerHTML = `
            <div class="modal-bg" id="${id}_bg">
                <div class="modal">
                    <h3>${title}</h3>
                    ${description
                ? `<div class="modal-sub">${description}</div>`
                : ""
            }

                    <div class="field">
                        <label for="${id}_amt">টাকার পরিমাণ</label>
                        <div class="money-input">
                            <span class="money-prefix">৳</span>
                            <input id="${id}_amt" type="number" inputmode="numeric"
                                   min="0" step="1" placeholder="0" autocomplete="off" />
                        </div>
                        <div class="chips">${chipsHtml}</div>
                    </div>

                    <div class="modal-actions">
                        <button class="btn btn-light" id="${id}_cancel">বাতিল</button>
                        <button class="btn btn-primary" id="${id}_ok">যোগ করুন</button>
                    </div>
                </div>
            </div>`;

        const input = document.getElementById(`${id}_amt`);
        const cleanup = (r) => {
            root.innerHTML = "";
            resolve(r);
        };

        document.getElementById(`${id}_bg`).addEventListener("click", (e) => {
            if (e.target.id === `${id}_bg`) cleanup(null);
        });
        document.getElementById(`${id}_cancel`).onclick = () => cleanup(null);

        root.querySelectorAll(".amount-chip").forEach((btn) => {
            btn.onclick = () => {
                input.value = btn.dataset.amount;
                root.querySelectorAll(".amount-chip").forEach((b) =>
                    b.classList.remove("selected")
                );
                btn.classList.add("selected");
            };
        });

        const submit = () => {
            const v = Number(input.value);
            if (!v || v <= 0) {
                input.focus();
                if (input.animate) {
                    input.animate(
                        [
                            { transform: "translateX(0)" },
                            { transform: "translateX(-6px)" },
                            { transform: "translateX(6px)" },
                            { transform: "translateX(-4px)" },
                            { transform: "translateX(0)" },
                        ],
                        { duration: 250, easing: "ease-in-out" }
                    );
                }
                return;
            }
            cleanup(v);
        };

        document.getElementById(`${id}_ok`).onclick = submit;
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") submit();
        });

        setTimeout(() => input.focus(), 80);
    });
}

/* ============================================================
   ROUTING
   ============================================================ */
const VIEW_TITLES = {
    viewDashboard: "হিসাব",
    viewAddPerson: "নতুন মানুষ",
    viewPerson: "হিসাব",
};

function show(id) {
    currentView = id;
    ["viewDashboard", "viewAddPerson", "viewPerson"].forEach((v) =>
        document.getElementById(v).classList.toggle("hidden", v !== id)
    );
    document.getElementById("pageTitle").textContent = VIEW_TITLES[id] || "হিসাব";
    window.scrollTo(0, 0);
}

function showDashboard() {
    currentPersonId = null;
    renderDashboard();
    show("viewDashboard");
}

function showAddPerson() {
    const f = document.getElementById("addPersonForm");
    if (f) f.reset();
    show("viewAddPerson");
    setTimeout(() => {
        const n = document.getElementById("apName");
        if (n) n.focus();
    }, 100);
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
    document.getElementById("pageTitle").textContent = p.name;
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
   DASHBOARD  (পাওনা-focused: no quick buttons, cards are clickable)
   ============================================================ */
function renderDashboard() {
    const grid = document.getElementById("peopleGrid");
    const sb = document.getElementById("searchBar");
    const summary = document.getElementById("dashSummary");

    const people = db.people;

    /* -------- summary strip (Only "মোট পাওনা") -------- */
    if (people.length === 0) {
        summary.hidden = true;
        summary.innerHTML = "";
    } else {
        let receivable = 0; // they owe me
        people.forEach((p) => {
            const t = totalsOf(p);
            if (t.net > 0) receivable += t.net;
        });
        summary.hidden = false;
        summary.innerHTML = `
            <div class="summary-item in">
                <span>মোট পাওনা</span>
                <b>${money(receivable)}</b>
            </div>`;
    }

    /* -------- search bar solo mode -------- */
    if (sb) sb.classList.toggle("solo", people.length === 0);

    /* -------- empty state -------- */
    if (people.length === 0) {
        grid.innerHTML = `
            <div class="empty" style="grid-column:1/-1">
                <div class="icon">📋</div>
                <h3>এখনো কেউ যোগ করা হয়নি</h3>
                <p>হিসাব শুরু করতে "যোগ" বাটনে চাপ দিন।</p>
            </div>`;
        return;
    }

    /* -------- filter -------- */
    const box = document.getElementById("searchBox");
    const q = (box ? box.value : "").trim().toLowerCase();

    const clearBtn = document.getElementById("searchClear");
    if (clearBtn) clearBtn.hidden = !q;

    const list = q
        ? people.filter(
            (p) =>
                (p.name || "").toLowerCase().includes(q) ||
                (p.bkashNumber || "").includes(q) ||
                (p.whatsappNumber || "").includes(q)
        )
        : people;

    if (list.length === 0) {
        grid.innerHTML = `
            <div class="empty" style="grid-column:1/-1">
                <div class="icon">🔍</div>
                <h3>কাউকে পাওয়া যায়নি</h3>
                <p>অন্য নাম বা নম্বর দিয়ে খুঁজুন।</p>
            </div>`;
        return;
    }

    /* -------- cards (no quick buttons, whole card clickable) -------- */
    grid.innerHTML = list
        .map((p, i) => {
            const t = totalsOf(p);
            const count = (p.transactions || []).length;
            const cls = balClass(t.net);
            const label = balLabel(t.net);
            const meta = count === 0 ? "কোনো লেনদেন নেই" : `${count}টি লেনদেন`;

            return `
        <div class="person-card" style="animation-delay:${Math.min(i, 8) * 40}ms">
            <div class="pc-head" data-open="${p.id}" role="button" tabindex="0">
                ${avatarHTML(p, "avatar-sm")}
                <div class="pc-info">
                    <h3>${esc(p.name)}</h3>
                    <div class="pc-meta">${meta}</div>
                </div>
                <div class="pc-bal-wrap">
                    <div class="pc-bal bal-${cls}">${money(Math.abs(t.net))}</div>
                    <div class="pc-bal-label">${label}</div>
                </div>
                <div class="pc-chevron">›</div>
            </div>
        </div>`;
        })
        .join("");

    /* -------- wire up events -------- */
    grid.querySelectorAll("[data-open]").forEach((el) => {
        el.addEventListener("click", () => showPerson(el.dataset.open));
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                showPerson(el.dataset.open);
            }
        });
    });
}

/* ============================================================
   QUICK TRANSACTION (from person detail)
   ============================================================ */
async function quickTxn(id, type) {
    const p = getPerson(id);
    if (!p) return;
    const isSend = type === "send"; // send = নতুন বাকি দিয়েছি
    const t = totalsOf(p);
    const balText =
        t.net === 0 ? "সমান" : `${money(Math.abs(t.net))} ${balLabel(t.net)}`;

    const amount = await askAmount({
        title: isSend ? "নতুন বাকি" : "টাকা পেলাম",
        description: `<b>${esc(p.name)}</b> · এখন ${balText}`,
    });
    if (!amount) return;

    try {
        addTransaction(id, {
            type,
            amount,
            date: new Date().toISOString(),
        });
        toast("যোগ হয়েছে ✔", "success");
        if (currentView === "viewPerson") renderPerson(id);
        else renderDashboard();
    } catch (err) {
        toast("কিছু ভুল হয়েছে", "error");
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

    const cls = balClass(t.net);
    const label = balLabel(t.net);

    const rowsHtml = txns.length
        ? txns
            .map((tx) => {
                const isSend = tx.type === "send";
                return `
            <div class="lg-row">
                <div class="lg-icon ${isSend ? "out" : "in"}">
                    ${isSend ? "↓" : "↑"}
                </div>
                <div class="lg-main">
                    <div class="lg-note">${isSend ? "বাকি দিয়েছি" : "টাকা পেয়েছি"}</div>
                    <div class="lg-date">${fmtDate(tx.date)}</div>
                </div>
                <div class="lg-col ${isSend ? "lg-out" : "lg-in"}">
                    ${isSend ? "−" : "+"}${money(tx.amount)}
                </div>
                <button class="tx-del" data-del="${tx.id}" aria-label="মুছুন">✕</button>
            </div>`;
            })
            .join("")
        : `<div class="empty" style="padding:40px 20px;border:0;background:transparent">
               <div class="icon">📭</div>
               <p>এখনো কোনো লেনদেন নেই।</p>
           </div>`;

    const subParts = [];
    if (p.bkashNumber) subParts.push(`<span>💳 ${esc(p.bkashNumber)}</span>`);
    if (p.whatsappNumber) subParts.push(`<span>📱 ${esc(p.whatsappNumber)}</span>`);

    document.getElementById("personDetail").innerHTML = `
        <div class="panel">
            <div class="person-header">
                ${avatarHTML(p, "avatar-lg")}
                <div class="person-header-info">
                    <h2 class="person-header-name">${esc(p.name)}</h2>
                    <div class="lg-big bal-${cls}">${money(Math.abs(t.net))}</div>
                    <div class="lg-big-label">${label}</div>
                    ${subParts.length
            ? `<div class="person-header-sub">${subParts.join("")}</div>`
            : ""
        }
                </div>
            </div>

            <div class="lg-totals">
                <div class="lg-total lg-total-out">
                    <span>মোট বাকি দিয়েছি</span>
                    <b>${money(t.given)}</b>
                </div>
                <div class="lg-total lg-total-in">
                    <span>মোট পেয়েছি</span>
                    <b>${money(t.got)}</b>
                </div>
            </div>

            <div class="detail-actions">
                <button class="pc-btn pc-send" data-txn="send" data-id="${p.id}">
                    + নতুন বাকি
                </button>
                <button class="pc-btn pc-receive" data-txn="receive" data-id="${p.id}">
                    ✓ টাকা পেলাম
                </button>
                ${p.whatsappNumber
            ? `<button class="pc-btn pc-wa" data-wa="${p.id}">📱 হোয়াটসঅ্যাপে জানান</button>`
            : ""
        }
            </div>
        </div>

        <div class="panel lg-panel">
            <h3 class="section-label">📜 হিসাব (${txns.length})</h3>
            ${rowsHtml}
        </div>
    `;

    /* -------- wire up events -------- */
    const detail = document.getElementById("personDetail");
    detail.querySelectorAll("[data-txn]").forEach((el) => {
        el.addEventListener("click", () => quickTxn(el.dataset.id, el.dataset.txn));
    });
    detail.querySelectorAll("[data-wa]").forEach((el) => {
        el.addEventListener("click", () => waRequest(el.dataset.wa));
    });
    detail.querySelectorAll("[data-del]").forEach((el) => {
        el.addEventListener("click", () => deleteTxn(p.id, el.dataset.del));
    });
}

/* ============================================================
   WHATSAPP REQUEST  (পাওনা-focused message)
   ============================================================ */
function waRequest(id) {
    const p = getPerson(id);
    if (!p || !p.whatsappNumber) return;
    const t = totalsOf(p);

    let msg;
    if (t.net > 0) {
        msg = `আসসালামু আলাইকুম। আমাদের হিসাব অনুযায়ী আপনার কাছে আমার ${money(
            t.net
        )} পাওনা আছে।`;
    } else if (t.net < 0) {
        msg = `আসসালামু আলাইকুম। আমাদের হিসাব অনুযায়ী আপনার ${money(
            -t.net
        )} পাওনা আছে।`;
    } else {
        msg = `আসসালামু আলাইকুম। আমাদের হিসাব সমান।`;
    }
    if (p.bkashNumber) msg += `\nবিকাশ: ${p.bkashNumber}`;

    let num = p.whatsappNumber.replace(/\D/g, "");
    if (num.startsWith("01") && num.length === 11) num = "88" + num;
    if (num.length === 11 && !num.startsWith("880")) num = "88" + num;

    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
}

/* ============================================================
   DELETE TRANSACTION (with undo)
   ============================================================ */
async function deleteTxn(personId, txnId) {
    const ok = await confirmModal({
        title: "মুছে ফেলবেন?",
        description:
            "এই লেনদেনটি মুছে ফেলা হবে। চাইলে সাথে সাথে ফিরিয়ে আনতে পারবেন।",
        submitLabel: "মুছুন",
        cancelLabel: "বাতিল",
        danger: true,
    });
    if (!ok) return;

    try {
        const removed = deleteTransaction(personId, txnId);

        if (currentView === "viewPerson") renderPerson(personId);
        else renderDashboard();

        toast("মুছে ফেলা হয়েছে", "", {
            actionLabel: "ফিরিয়ে আনুন",
            onAction: () => {
                restoreTransaction(personId, removed);
                if (currentView === "viewPerson") renderPerson(personId);
                else renderDashboard();
                toast("ফিরিয়ে আনা হয়েছে", "success");
            },
            duration: 4500,
        });
    } catch (err) {
        toast("মুছতে পারা যায়নি", "error");
    }
}

/* ============================================================
   SUBMIT PERSON
   ============================================================ */
function submitPerson(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    const amount = Number(f.get("amount")) || 0;
    const bkashNumber = String(f.get("bkashNumber") || "").replace(/\D/g, "");
    const whatsappNumber = String(f.get("whatsappNumber") || "").replace(
        /\D/g,
        ""
    );

    if (!name) {
        toast("নাম লিখুন", "error");
        return;
    }

    try {
        const p = createPerson({ name, bkashNumber, whatsappNumber });

        /* Starting amount = they owe me → a "send" (I gave them) */
        if (amount > 0) {
            addTransaction(p.id, {
                type: "send",
                amount,
                date: new Date().toISOString(),
                notes: "শুরুর বাকি",
            });
        }

        e.target.reset();
        toast("যোগ হয়েছে ✔", "success");
        showDashboard();
    } catch (err) {
        toast("যোগ করা যায়নি", "error");
    }
}

/* ============================================================
   ZOOM / COPY / CONTEXT-MENU LOCKDOWN
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
function init() {
    renderLogo();

    /* back button */
    document.getElementById("backBtn").addEventListener("click", () => {
        if (
            currentView === "viewAddPerson" ||
            currentView === "viewPerson"
        ) {
            showDashboard();
            return;
        }
        window.location.href = "/";
    });

    /* add person */
    document
        .getElementById("addPersonBtn")
        .addEventListener("click", showAddPerson);

    /* search */
    const searchBox = document.getElementById("searchBox");
    const searchClear = document.getElementById("searchClear");

    searchBox.addEventListener("input", renderDashboard);
    searchClear.addEventListener("click", () => {
        searchBox.value = "";
        searchBox.focus();
        renderDashboard();
    });

    /* form */
    document
        .getElementById("addPersonForm")
        .addEventListener("submit", submitPerson);

    /* start */
    showDashboard();
}

init();