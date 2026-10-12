/* ============================================================
   ব্যাংক হিসাব — personal bank ledger
   Storage: localStorage. No backend.

   Bank     = { id, name, accountNumber, transactions[] }
   Txn type = "deposit"  → জমা (money in)
              "withdraw" → উত্তোলন (money out)
   Balance  = totalDeposits − totalWithdrawals
   ============================================================ */

const STORAGE_KEY = "bank_hisab_v1";

/* ============================================================
   STORAGE
   ============================================================ */
function loadDB() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { banks: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.banks)) return { banks: [] };
        return parsed;
    } catch (_) {
        return { banks: [] };
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
let currentBankId = null;

/* ============================================================
   DATA LAYER
   ============================================================ */
function getAllBanks() {
    return db.banks;
}

function getBank(id) {
    return db.banks.find((b) => b.id === id) || null;
}

function createBank({ name, accountNumber = "" }) {
    const bank = {
        id: uid(),
        name,
        accountNumber,
        transactions: [],
        createdAt: new Date().toISOString(),
    };
    db.banks.push(bank);
    saveDB();
    return bank;
}

function addTransaction(bankId, { type, amount, date, notes = null }) {
    const b = getBank(bankId);
    if (!b) throw new Error("bank not found");
    const txn = {
        id: uid(),
        type,
        amount: Number(amount),
        date: date || new Date().toISOString(),
        notes,
    };
    b.transactions = b.transactions || [];
    b.transactions.push(txn);
    saveDB();
    return txn;
}

function deleteTransaction(bankId, txnId) {
    const b = getBank(bankId);
    if (!b) throw new Error("bank not found");
    const idx = (b.transactions || []).findIndex((t) => t.id === txnId);
    if (idx < 0) throw new Error("Transaction not found");
    const [removed] = b.transactions.splice(idx, 1);
    saveDB();
    return removed;
}

function restoreTransaction(bankId, txn) {
    const b = getBank(bankId);
    if (!b || !txn) return;
    b.transactions = b.transactions || [];
    b.transactions.push(txn);
    saveDB();
}

/* ============================================================
   LEDGER MATH
   ============================================================ */
function totalsOf(bank) {
    let deposited = 0;
    let withdrawn = 0;
    (bank.transactions || []).forEach((t) => {
        const a = Number(t.amount || 0);
        if (t.type === "withdraw") withdrawn += a;
        else deposited += a;
    });
    return { deposited, withdrawn, balance: deposited - withdrawn };
}

function grandTotal() {
    return db.banks.reduce((sum, b) => sum + totalsOf(b).balance, 0);
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

/* Bank initials — use first letters of each word, up to 2 chars */
function initialsOf(name) {
    const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function avatarHTML(bank, sizeClass) {
    return `<div class="avatar ${sizeClass}">${esc(initialsOf(bank.name))}</div>`;
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

function bnNumber(n) {
    return Number(n || 0).toLocaleString("bn-BD");
}

/* ============================================================
   TOAST
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

const QUICK_AMOUNTS = [500, 1000, 5000, 10000];

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
    viewDashboard: "ব্যাংক হিসাব",
    viewAddBank: "নতুন ব্যাংক",
    viewBank: "ব্যাংক হিসাব",
};

function show(id) {
    currentView = id;
    ["viewDashboard", "viewAddBank", "viewBank"].forEach((v) =>
        document.getElementById(v).classList.toggle("hidden", v !== id)
    );
    document.getElementById("pageTitle").textContent =
        VIEW_TITLES[id] || "ব্যাংক হিসাব";
    window.scrollTo(0, 0);
}

function showDashboard() {
    currentBankId = null;
    renderDashboard();
    show("viewDashboard");
}

function showAddBank() {
    const f = document.getElementById("addBankForm");
    if (f) f.reset();
    show("viewAddBank");
    setTimeout(() => {
        const n = document.getElementById("abName");
        if (n) n.focus();
    }, 100);
}

function showBank(id) {
    const b = getBank(id);
    if (!b) {
        toast("ব্যাংক খুঁজে পাওয়া যায়নি", "error");
        return;
    }
    currentBankId = id;
    renderBank(id);
    show("viewBank");
    document.getElementById("pageTitle").textContent = b.name;
}

/* ============================================================
   LOGO (bank-styled)
   ============================================================ */
const DEFAULT_LOGO =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f8055"/>
      <stop offset="1" stop-color="#063d29"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="18" fill="url(#g)"/>
  <path d="M32 14 L48 24 L48 28 L16 28 L16 24 Z" fill="#fff"/>
  <rect x="18" y="30" width="4" height="16" fill="#fff"/>
  <rect x="27" y="30" width="4" height="16" fill="#fff"/>
  <rect x="36" y="30" width="4" height="16" fill="#fff"/>
  <rect x="45" y="30" width="4" height="16" fill="#fff"/>
  <rect x="14" y="48" width="36" height="4" fill="#fff"/>
</svg>`
    );

function renderLogo() {
    document.getElementById("brandLogo").src = DEFAULT_LOGO;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
    const list = document.getElementById("banksList");
    const sb = document.getElementById("searchBar");
    const heroAmount = document.getElementById("heroAmount");
    const heroSub = document.getElementById("heroSub");

    const banks = db.banks;

    /* -------- hero total -------- */
    const total = grandTotal();
    heroAmount.textContent = money(total);
    heroSub.textContent =
        banks.length === 0
            ? "কোনো ব্যাংক নেই"
            : `${bnNumber(banks.length)}টি ব্যাংক`;

    /* -------- search solo -------- */
    if (sb) sb.classList.toggle("solo", banks.length === 0);

    /* -------- empty -------- */
    if (banks.length === 0) {
        list.innerHTML = `
            <div class="empty" style="grid-column:1/-1">
                <div class="icon">🏦</div>
                <h3>এখনো কোনো ব্যাংক যোগ করা হয়নি</h3>
                <p>শুরু করতে "যোগ" বাটনে চাপ দিন।</p>
            </div>`;
        return;
    }

    /* -------- filter -------- */
    const box = document.getElementById("searchBox");
    const q = (box ? box.value : "").trim().toLowerCase();

    const clearBtn = document.getElementById("searchClear");
    if (clearBtn) clearBtn.hidden = !q;

    const filtered = q
        ? banks.filter(
            (b) =>
                (b.name || "").toLowerCase().includes(q) ||
                (b.accountNumber || "").toLowerCase().includes(q)
        )
        : banks;

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty" style="grid-column:1/-1">
                <div class="icon">🔍</div>
                <h3>কিছু পাওয়া যায়নি</h3>
                <p>অন্য নাম বা নম্বর দিয়ে খুঁজুন।</p>
            </div>`;
        return;
    }

    /* -------- cards -------- */
    list.innerHTML = filtered
        .map((b, i) => {
            const t = totalsOf(b);
            const count = (b.transactions || []).length;
            const meta = b.accountNumber
                ? `•••• ${esc(b.accountNumber.slice(-4))}`
                : count === 0
                    ? "কোনো লেনদেন নেই"
                    : `${bnNumber(count)}টি লেনদেন`;

            return `
        <div class="bank-card" style="animation-delay:${Math.min(i, 8) * 40}ms"
             data-open="${b.id}" role="button" tabindex="0">
            <div class="bc-head">
                ${avatarHTML(b, "avatar-sm")}
                <div class="bc-info">
                    <h3>${esc(b.name)}</h3>
                    <div class="bc-meta">${meta}</div>
                </div>
                <div class="bc-bal-wrap">
                    <div class="bc-bal">${money(t.balance)}</div>
                    <div class="bc-bal-label">ব্যালেন্স</div>
                </div>
                <div class="bc-chevron">›</div>
            </div>
        </div>`;
        })
        .join("");

    /* -------- wire up -------- */
    list.querySelectorAll("[data-open]").forEach((el) => {
        el.addEventListener("click", () => showBank(el.dataset.open));
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                showBank(el.dataset.open);
            }
        });
    });
}

/* ============================================================
   QUICK TRANSACTION — deposit / withdraw
   ============================================================ */
async function quickTxn(bankId, type) {
    const b = getBank(bankId);
    if (!b) return;

    const isDeposit = type === "deposit";
    const t = totalsOf(b);

    const amount = await askAmount({
        title: isDeposit ? "↓ জমা" : "↑ উত্তোলন",
        description: `<b>${esc(b.name)}</b> · ব্যালেন্স ${money(t.balance)}`,
    });
    if (!amount) return;

    try {
        addTransaction(bankId, {
            type,
            amount,
            date: new Date().toISOString(),
        });
        toast(isDeposit ? "জমা হয়েছে ✔" : "উত্তোলন হয়েছে ✔", "success");
        if (currentView === "viewBank") renderBank(bankId);
        else renderDashboard();
    } catch (err) {
        toast("কিছু ভুল হয়েছে", "error");
    }
}

/* ============================================================
   BANK DETAIL
   ============================================================ */
function renderBank(id) {
    const b = getBank(id);
    if (!b) {
        showDashboard();
        return;
    }

    const t = totalsOf(b);
    const txns = [...(b.transactions || [])].sort(
        (a, c) => new Date(c.date) - new Date(a.date)
    );

    const rowsHtml = txns.length
        ? txns
            .map((tx) => {
                const isDeposit = tx.type === "deposit";
                return `
            <div class="lg-row">
                <div class="lg-icon ${isDeposit ? "in" : "out"}">
                    ${isDeposit ? "↓" : "↑"}
                </div>
                <div class="lg-main">
                    <div class="lg-note">${isDeposit ? "জমা" : "উত্তোলন"}</div>
                    <div class="lg-date">${fmtDate(tx.date)}</div>
                </div>
                <div class="lg-col ${isDeposit ? "lg-in" : "lg-out"}">
                    ${isDeposit ? "+" : "−"}${money(tx.amount)}
                </div>
                <button class="tx-del" data-del="${tx.id}" aria-label="মুছুন">✕</button>
            </div>`;
            })
            .join("")
        : `<div class="empty" style="padding:40px 20px;border:0;background:transparent">
               <div class="icon">📭</div>
               <p>এখনো কোনো লেনদেন নেই।</p>
           </div>`;

    document.getElementById("bankDetail").innerHTML = `
        <div class="panel">
            <div class="bank-header">
                ${avatarHTML(b, "avatar-lg")}
                <div class="bank-header-info">
                    <h2 class="bank-header-name">${esc(b.name)}</h2>
                    ${b.accountNumber
            ? `<div class="bank-header-sub">অ্যাকাউন্ট: ${esc(
                b.accountNumber
            )}</div>`
            : ""
        }
                    <div class="lg-big">${money(t.balance)}</div>
                    <div class="lg-big-label">বর্তমান ব্যালেন্স</div>
                </div>
            </div>

            <div class="lg-totals">
                <div class="lg-total lg-total-in">
                    <span>মোট জমা</span>
                    <b>${money(t.deposited)}</b>
                </div>
                <div class="lg-total lg-total-out">
                    <span>মোট উত্তোলন</span>
                    <b>${money(t.withdrawn)}</b>
                </div>
            </div>

            <div class="detail-actions">
                <button class="pc-btn pc-deposit" data-txn="deposit" data-id="${b.id}">
                    ↓ জমা
                </button>
                <button class="pc-btn pc-withdraw" data-txn="withdraw" data-id="${b.id}">
                    ↑ উত্তোলন
                </button>
            </div>
        </div>

        <div class="panel lg-panel">
            <h3 class="section-label">📜 লেনদেন (${bnNumber(txns.length)})</h3>
            ${rowsHtml}
        </div>
    `;

    /* -------- wire up -------- */
    const detail = document.getElementById("bankDetail");
    detail.querySelectorAll("[data-txn]").forEach((el) => {
        el.addEventListener("click", () =>
            quickTxn(el.dataset.id, el.dataset.txn)
        );
    });
    detail.querySelectorAll("[data-del]").forEach((el) => {
        el.addEventListener("click", () => deleteTxn(b.id, el.dataset.del));
    });
}

/* ============================================================
   DELETE TRANSACTION (with undo)
   ============================================================ */
async function deleteTxn(bankId, txnId) {
    const ok = await confirmModal({
        title: "লেনদেন মুছে ফেলবেন?",
        description:
            "চাইলে সাথে সাথে ফিরিয়ে আনতে পারবেন।",
        submitLabel: "মুছুন",
        cancelLabel: "বাতিল",
        danger: true,
    });
    if (!ok) return;

    try {
        const removed = deleteTransaction(bankId, txnId);

        if (currentView === "viewBank") renderBank(bankId);
        else renderDashboard();

        toast("মুছে ফেলা হয়েছে", "", {
            actionLabel: "ফিরিয়ে আনুন",
            onAction: () => {
                restoreTransaction(bankId, removed);
                if (currentView === "viewBank") renderBank(bankId);
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
   SUBMIT BANK
   ============================================================ */
function submitBank(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    const accountNumber = String(f.get("accountNumber") || "").trim();
    const balance = Number(f.get("balance")) || 0;

    if (!name) {
        toast("ব্যাংকের নাম লিখুন", "error");
        return;
    }

    try {
        const b = createBank({ name, accountNumber });

        /* Starting balance = first deposit */
        if (balance > 0) {
            addTransaction(b.id, {
                type: "deposit",
                amount: balance,
                date: new Date().toISOString(),
                notes: "শুরুর ব্যালেন্স",
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
    () => {
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

    document.getElementById("backBtn").addEventListener("click", () => {
        if (currentView === "viewAddBank" || currentView === "viewBank") {
            showDashboard();
            return;
        }
        window.location.href = "/";
    });

    document
        .getElementById("addBankBtn")
        .addEventListener("click", showAddBank);

    const searchBox = document.getElementById("searchBox");
    const searchClear = document.getElementById("searchClear");

    searchBox.addEventListener("input", renderDashboard);
    searchClear.addEventListener("click", () => {
        searchBox.value = "";
        searchBox.focus();
        renderDashboard();
    });

    document
        .getElementById("addBankForm")
        .addEventListener("submit", submitBank);

    showDashboard();
}

init();