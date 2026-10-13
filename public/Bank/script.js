/* ============================================================
   ব্যাংক হিসাব — bank ledger (backend-driven)
   All data fetched/saved via REST API. No localStorage.

   Backend endpoints:
     GET    /api/banks                              → { banks: [...] }
     POST   /api/banks                              → { bank: {...} }
     POST   /api/banks/:id/transactions             → { transaction, summary }
     DELETE /api/banks/:id/transactions/:txnId      → { ok, summary }
     DELETE /api/banks/:id                          → { ok }

   Bank shape:
     { id, name, accountNumber, createdAt, summary, transactions: [...] }

   Summary shape:
     { totalDeposit, totalWithdraw, balance }

   Txn type:
     "deposit"  → জমা (money in)
     "withdraw" → উত্তোলন (money out)
   ============================================================ */

/* ------------------------------------------------------------
   CONFIG
------------------------------------------------------------ */
const API_BASE = "";
const API_ROOT = "/api/banks";

/* ============================================================
   API LAYER
   ============================================================ */
async function api(path, options = {}) {
    const url = API_BASE + path;
    const { headers, ...rest } = options;

    let res;
    try {
        res = await fetch(url, {
            ...rest,
            headers: {
                "Content-Type": "application/json",
                ...(headers || {}),
            },
        });
    } catch (netErr) {
        console.error("Network error:", netErr);
        throw new Error("সার্ভারের সাথে সংযোগ করা যায়নি");
    }

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (body && body.message) msg = body.message;
            else if (body && body.error) msg = body.error;
        } catch (_) { /* ignore */ }
        throw new Error(msg);
    }

    if (res.status === 204) return null;
    return res.json().catch(() => null);
}

/* ---- normalize a bank from the server ---- */
function normalizeBank(b) {
    if (!b) return null;
    return {
        id: b.id || b._id,
        name: b.name,
        accountNumber: b.accountNumber || "",
        createdAt: b.createdAt || new Date().toISOString(),
        summary: b.summary || null,
        transactions: Array.isArray(b.transactions) ? b.transactions : [],
    };
}

async function fetchBanks() {
    const data = await api(API_ROOT);
    const list = data && Array.isArray(data.banks) ? data.banks : [];
    return list.map(normalizeBank).filter(Boolean);
}

async function apiCreateBank({ name, accountNumber }) {
    const data = await api(API_ROOT, {
        method: "POST",
        body: JSON.stringify({ name, accountNumber }),
    });
    if (!data || !data.bank) throw new Error("Invalid response");
    return normalizeBank(data.bank);
}

async function apiAddTransaction(bankId, txn) {
    const data = await api(
        `${API_ROOT}/${encodeURIComponent(bankId)}/transactions`,
        {
            method: "POST",
            body: JSON.stringify(txn),
        }
    );
    if (!data || !data.transaction) throw new Error("Invalid response");
    return data;
}

async function apiDeleteTransaction(bankId, txnId) {
    return api(
        `${API_ROOT}/${encodeURIComponent(
            bankId
        )}/transactions/${encodeURIComponent(txnId)}`,
        { method: "DELETE" }
    );
}

async function apiDeleteBank(bankId) {
    return api(`${API_ROOT}/${encodeURIComponent(bankId)}`, {
        method: "DELETE",
    });
}

/* ============================================================
   STATE
   ============================================================ */
let db = { banks: [] };
let currentView = "viewDashboard";
let currentBankId = null;
let loading = false;

/* ============================================================
   DATA LAYER
   ============================================================ */
function getBank(id) {
    return db.banks.find((b) => b.id === id) || null;
}

/* ============================================================
   LEDGER MATH
   ============================================================ */
function totalsOf(bank) {
    if (bank.summary) {
        const deposited = Number(
            bank.summary.totalDeposit ?? bank.summary.totalIn ?? 0
        );
        const withdrawn = Number(
            bank.summary.totalWithdraw ?? bank.summary.totalOut ?? 0
        );
        const balance = Number(
            bank.summary.balance ?? (deposited - withdrawn)
        );
        return { deposited, withdrawn, balance };
    }

    let deposited = 0;
    let withdrawn = 0;
    (bank.transactions || []).forEach((t) => {
        const a = Number(t.amount || 0);
        if (t.type === "withdraw") withdrawn += a;
        else deposited += a;
    });
    return { deposited, withdrawn, balance: deposited - withdrawn };
}

function applySummary(b, summary) {
    if (!summary) return;
    b.summary = {
        totalDeposit: Number(
            summary.totalDeposit ?? summary.totalIn ?? 0
        ),
        totalWithdraw: Number(
            summary.totalWithdraw ?? summary.totalOut ?? 0
        ),
        balance: Number(summary.balance || 0),
    };
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
                    ${description ? `<div class="modal-sub">${description}</div>` : ""}
                    <div class="modal-actions">
                        <button class="btn btn-light" id="${id}_cancel">${esc(cancelLabel)}</button>
                        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="${id}_ok">${esc(submitLabel)}</button>
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

function askAmount({ title, description = "", namePlaceholder = "নাম লিখুন" }) {
    return new Promise((resolve) => {
        const id = "m" + uid();
        const root = document.getElementById("modalRoot");

        const chipsHtml = QUICK_AMOUNTS.map(
            (v) =>
                `<button type="button" class="amount-chip" data-amount="${v}">${v.toLocaleString("en-IN")}</button>`
        ).join("");

        root.innerHTML = `
            <div class="modal-bg" id="${id}_bg">
                <div class="modal">
                    <h3>${title}</h3>
                    ${description ? `<div class="modal-sub">${description}</div>` : ""}

                    <div class="field">
                        <label for="${id}_name">নাম <span class="opt">(ঐচ্ছিক)</span></label>
                        <input id="${id}_name" type="text" placeholder="${esc(namePlaceholder)}" autocomplete="off" />
                    </div>

                    <div class="field">
                        <label for="${id}_amt">টাকার পরিমাণ</label>
                        <div class="money-input">
                            <span class="money-prefix">৳</span>
                            <input id="${id}_amt" type="number" inputmode="numeric" min="0" step="1" placeholder="0" autocomplete="off" />
                        </div>
                        <div class="chips">${chipsHtml}</div>
                    </div>

                    <div class="modal-actions">
                        <button class="btn btn-light" id="${id}_cancel">বাতিল</button>
                        <button class="btn btn-primary" id="${id}_ok">যোগ করুন</button>
                    </div>
                </div>
            </div>`;

        const nameInput = document.getElementById(`${id}_name`);
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
                root.querySelectorAll(".amount-chip").forEach((b) => b.classList.remove("selected"));
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
            cleanup({
                amount: v,
                name: (nameInput.value || "").trim() || null,
            });
        };

        document.getElementById(`${id}_ok`).onclick = submit;

        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.focus();
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") submit();
        });

        setTimeout(() => nameInput.focus(), 80);
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

    const title = document.getElementById("pageTitle");
    const sub = document.getElementById("pageSub");

    if (title) title.textContent = VIEW_TITLES[id] || "ব্যাংক হিসাব";
    if (sub) {
        sub.textContent =
            id === "viewAddBank"
                ? "নতুন ব্যাংক যোগ করুন"
                : id === "viewBank"
                    ? "লেনদেনের বিস্তারিত"
                    : "সব ব্যাংকের হিসাব";
    }
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
    const title = document.getElementById("pageTitle");
    if (title) title.textContent = b.name;
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
      <stop offset="0" stop-color="#e8437a"/>
      <stop offset="1" stop-color="#a8153f"/>
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
    const el = document.getElementById("brandLogo");
    if (el) el.src = DEFAULT_LOGO;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
    const grid = document.getElementById("banksList");
    const sb = document.getElementById("searchBar");
    const hero = document.getElementById("dashHero");
    const head = document.getElementById("banksHead");
    const countEl = document.getElementById("banksCount");

    const banks = db.banks;

    /* -------- loading -------- */
    if (loading) {
        if (hero) hero.innerHTML = "";
        if (head) head.style.display = "none";
        if (sb) sb.classList.add("solo");
        if (grid) {
            grid.innerHTML = `
                <div class="empty">
                    <div class="icon">⏳</div>
                    <h3>লোড হচ্ছে…</h3>
                    <p>ডেটা আনা হচ্ছে, একটু অপেক্ষা করুন।</p>
                </div>`;
        }
        return;
    }

    /* -------- empty -------- */
    if (banks.length === 0) {
        if (hero) {
            hero.innerHTML = `
                <div class="home-hero">
                    <div class="home-hero-top">
                        <span class="home-hero-label">
                            <span class="home-hero-ico">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M3 21h18"/>
                                    <path d="M5 21V10l7-5 7 5v11"/>
                                </svg>
                            </span>
                            মোট ব্যালেন্স
                        </span>
                    </div>
                    <b class="home-hero-value">৳ 0</b>
                </div>`;
        }
        if (head) head.style.display = "none";
        if (sb) sb.classList.add("solo");
        if (grid) {
            grid.innerHTML = `
                <div class="empty">
                    <div class="icon">🏦</div>
                    <h3>এখনো কোনো ব্যাংক যোগ করা হয়নি</h3>
                    <p>শুরু করতে "যোগ" বাটনে চাপ দিন।</p>
                </div>`;
        }
        return;
    }

    /* -------- hero -------- */
    const total = grandTotal();
    if (hero) {
        hero.innerHTML = `
            <div class="home-hero">
                <div class="home-hero-top">
                    <span class="home-hero-label">
                        <span class="home-hero-ico">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 21h18"/>
                                <path d="M5 21V10l7-5 7 5v11"/>
                            </svg>
                        </span>
                        মোট ব্যালেন্স
                    </span>
                </div>
                <b class="home-hero-value">${money(total)}</b>
            </div>`;
    }

    if (sb) sb.classList.remove("solo");

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

    /* -------- section head -------- */
    if (head) head.style.display = "";
    if (countEl) countEl.textContent = `${bnNumber(filtered.length)} টি`;

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty">
                <div class="icon">🔍</div>
                <h3>কিছু পাওয়া যায়নি</h3>
                <p>অন্য নাম বা নম্বর দিয়ে খুঁজুন।</p>
            </div>`;
        return;
    }

    /* -------- cards -------- */
    grid.innerHTML = filtered
        .map((b, i) => {
            const t = totalsOf(b);
            const count = (b.transactions || []).length;
            const meta = b.accountNumber
                ? `অ্যাকাউন্ট •••• ${esc(b.accountNumber.slice(-4))}`
                : count === 0
                    ? "কোনো লেনদেন নেই"
                    : `${bnNumber(count)}টি লেনদেন`;

            return `
        <article class="bank-card" style="animation-delay:${Math.min(i, 8) * 40}ms">
            <button class="bc-head" data-open="${b.id}" type="button">
                <div class="bc-info">
                    <h3>${esc(b.name)}</h3>
                    <div class="bc-meta">${meta}</div>
                </div>
                <div class="bc-bal-wrap">
                    <div class="bc-bal">${money(t.balance)}</div>
                    <div class="bc-bal-label">ব্যালেন্স</div>
                </div>
                <span class="bc-chevron">›</span>
            </button>
        </article>`;
        })
        .join("");

    grid.querySelectorAll("[data-open]").forEach((el) => {
        el.addEventListener("click", () => showBank(el.dataset.open));
    });
}

/* ============================================================
   RELOAD FROM SERVER
   ============================================================ */
async function reload({ silent = false } = {}) {
    if (!silent) {
        loading = true;
        renderDashboard();
    }
    try {
        db.banks = await fetchBanks();
        loading = false;
        if (currentView === "viewBank" && currentBankId) {
            renderBank(currentBankId);
        } else {
            renderDashboard();
        }
    } catch (err) {
        loading = false;
        renderDashboard();
        if (!silent) toast("ডেটা আনতে ব্যর্থ: " + err.message, "error");
    }
}

/* ============================================================
   QUICK TRANSACTION — deposit / withdraw
   ============================================================ */
async function quickTxn(bankId, type) {
    const b = getBank(bankId);
    if (!b) return;

    const isDeposit = type === "deposit";
    const t = totalsOf(b);

    const result = await askAmount({
        title: isDeposit ? "জমা" : "উত্তোলন",
        description: `<b>${esc(b.name)}</b> · ব্যালেন্স ${money(t.balance)}`,
        namePlaceholder: isDeposit ? "যিনি জমা দিলেন" : "যিনি নিলেন",
    });
    if (!result) return;

    try {
        const data = await apiAddTransaction(bankId, {
            type,
            amount: result.amount,
            name: result.name,
            date: new Date().toISOString(),
        });

        /* update local mirror */
        b.transactions = b.transactions || [];
        b.transactions.push(data.transaction);
        applySummary(b, data.summary);

        toast(isDeposit ? "জমা হয়েছে ✔" : "উত্তোলন হয়েছে ✔", "success");
        if (currentView === "viewBank") renderBank(bankId);
        else renderDashboard();
    } catch (err) {
        toast("সেভ করা যায়নি: " + err.message, "error");
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
                const personName = tx.name ? esc(tx.name) : "";
                return `
            <div class="lg-row">
                <div class="lg-icon ${isDeposit ? "in" : "out"}">
                    ${isDeposit ? "↓" : "↑"}
                </div>
                <div class="lg-main">
                    <div class="lg-note">${isDeposit ? "জমা" : "উত্তোলন"}</div>
                    ${personName ? `<div class="lg-person">👤 ${personName}</div>` : ""}
                    <div class="lg-date">${fmtDate(tx.date)}</div>
                </div>
                <div class="lg-col ${isDeposit ? "lg-in" : "lg-out"}">
                    ${isDeposit ? "+" : "−"}${money(tx.amount)}
                </div>
                <button class="tx-del" data-del="${tx.id}" aria-label="মুছুন">✕</button>
            </div>`;
            })
            .join("")
        : `<div class="empty" style="padding:40px 20px;border:0;background:transparent;box-shadow:none">
               <div class="icon">📭</div>
               <p>এখনো কোনো লেনদেন নেই।</p>
           </div>`;

    document.getElementById("bankDetail").innerHTML = `
        <div class="bank-hero">
            <div class="bank-hero-top">
                <div class="bank-hero-info">
                    <h2>${esc(b.name)}</h2>
                    ${b.accountNumber
            ? `<p>অ্যাকাউন্ট: ${esc(b.accountNumber)}</p>`
            : `<p>${bnNumber(txns.length)}টি লেনদেন</p>`
        }
                </div>
                <button class="bank-del" type="button" data-del-bank="${b.id}"
                        aria-label="ব্যাংক মুছুন" title="মুছুন">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                        <path d="M10 11v6M14 11v6"></path>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
                    </svg>
                    <span>মুছুন</span>
                </button>
            </div>

            <div class="bank-hero-bal">
                <b class="ph-bal">${money(t.balance)}</b>
                <span class="ph-state">বর্তমান ব্যালেন্স</span>
            </div>
        </div>

        <div class="panel">
            <div class="sum-grid">
                <div class="sum-item sum-item--in">
                    <span class="sum-label">মোট জমা</span>
                    <span class="sum-value">${money(t.deposited)}</span>
                </div>
                <div class="sum-item sum-item--out">
                    <span class="sum-label">মোট উত্তোলন</span>
                    <span class="sum-value">${money(t.withdrawn)}</span>
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
            <div class="section-head" style="margin:0 0 12px">
                <h2 class="section-title"><span class="title-dot"></span>লেনদেন</h2>
                <span class="section-count">${bnNumber(txns.length)}</span>
            </div>
            ${rowsHtml}
        </div>
    `;

    const detail = document.getElementById("bankDetail");
    detail.querySelectorAll("[data-txn]").forEach((el) => {
        el.addEventListener("click", () => quickTxn(el.dataset.id, el.dataset.txn));
    });
    detail.querySelectorAll("[data-del]").forEach((el) => {
        el.addEventListener("click", () => deleteTxn(b.id, el.dataset.del));
    });
    detail.querySelectorAll("[data-del-bank]").forEach((el) => {
        el.addEventListener("click", () => removeBank(el.dataset.delBank));
    });
}

/* ============================================================
   DELETE BANK
   ============================================================ */
async function removeBank(bankId) {
    const b = getBank(bankId);
    if (!b) return;

    const count = (b.transactions || []).length;
    const t = totalsOf(b);

    const ok = await confirmModal({
        title: "ব্যাংক মুছে ফেলবেন?",
        description:
            `<b>${esc(b.name)}</b> সম্পূর্ণভাবে মুছে ফেলা হবে।` +
            (count
                ? ` এর <b>${bnNumber(count)}টি</b> লেনদেনের হিসাবও (বর্তমান ব্যালেন্স <b>${money(
                    t.balance
                )}</b>) মুছে যাবে।`
                : "") +
            `<br><br>এই কাজটি ফিরিয়ে আনা যাবে না।`,
        submitLabel: "মুছুন",
        cancelLabel: "বাতিল",
        danger: true,
    });
    if (!ok) return;

    const btns = document.querySelectorAll(
        `[data-del-bank="${CSS.escape(String(bankId))}"]`
    );
    btns.forEach((btn) => (btn.disabled = true));

    try {
        await apiDeleteBank(bankId);

        db.banks = db.banks.filter((x) => x.id !== bankId);
        currentBankId = null;

        toast(`${b.name} মুছে ফেলা হয়েছে`, "success");
        showDashboard();
    } catch (err) {
        btns.forEach((btn) => (btn.disabled = false));
        toast("মুছতে পারা যায়নি: " + err.message, "error");
    }
}

/* ============================================================
   DELETE TRANSACTION (with undo)
   ============================================================ */
async function deleteTxn(bankId, txnId) {
    const ok = await confirmModal({
        title: "লেনদেন মুছে ফেলবেন?",
        description: "চাইলে সাথে সাথে ফিরিয়ে আনতে পারবেন।",
        submitLabel: "মুছুন",
        cancelLabel: "বাতিল",
        danger: true,
    });
    if (!ok) return;

    const b = getBank(bankId);
    if (!b) return;

    const idx = (b.transactions || []).findIndex((t) => t.id === txnId);
    if (idx < 0) return;
    const removed = b.transactions[idx];

    try {
        const data = await apiDeleteTransaction(bankId, txnId);

        b.transactions.splice(idx, 1);
        if (data && data.summary) applySummary(b, data.summary);
        else b.summary = null;

        if (currentView === "viewBank") renderBank(bankId);
        else renderDashboard();

        toast("মুছে ফেলা হয়েছে", "", {
            actionLabel: "ফিরিয়ে আনুন",
            onAction: async () => {
                try {
                    const restored = await apiAddTransaction(bankId, {
                        type: removed.type,
                        amount: removed.amount,
                        date: removed.date,
                        name: removed.name || null,
                        notes: removed.notes || null,
                    });
                    b.transactions.push(restored.transaction);
                    applySummary(b, restored.summary);
                    if (currentView === "viewBank") renderBank(bankId);
                    else renderDashboard();
                    toast("ফিরিয়ে আনা হয়েছে", "success");
                } catch (err) {
                    toast("ফিরিয়ে আনা যায়নি: " + err.message, "error");
                }
            },
            duration: 4500,
        });
    } catch (err) {
        toast("মুছতে পারা যায়নি: " + err.message, "error");
    }
}

/* ============================================================
   SUBMIT BANK
   ============================================================ */
async function submitBank(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    const accountNumber = String(f.get("accountNumber") || "").trim();
    const balance = Number(f.get("balance")) || 0;

    if (!name) {
        toast("ব্যাংকের নাম লিখুন", "error");
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "সেভ হচ্ছে…";
    }

    try {
        const b = await apiCreateBank({ name, accountNumber });
        db.banks.push(b);

        /* Starting balance = first deposit */
        if (balance > 0) {
            const data = await apiAddTransaction(b.id, {
                type: "deposit",
                amount: balance,
                date: new Date().toISOString(),
                notes: "শুরুর ব্যালেন্স",
            });
            b.transactions.push(data.transaction);
            applySummary(b, data.summary);
        }

        e.target.reset();
        toast("যোগ হয়েছে ✔", "success");
        showDashboard();
    } catch (err) {
        toast("যোগ করা যায়নি: " + err.message, "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
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
async function init() {
    renderLogo();

    const backBtn = document.getElementById("backBtn");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            if (currentView === "viewAddBank" || currentView === "viewBank") {
                showDashboard();
                return;
            }
            window.location.href = "/";
        });
    }

    const addBtn = document.getElementById("addBankBtn");
    if (addBtn) addBtn.addEventListener("click", showAddBank);

    const searchBox = document.getElementById("searchBox");
    const searchClear = document.getElementById("searchClear");

    if (searchBox) searchBox.addEventListener("input", renderDashboard);
    if (searchClear) {
        searchClear.addEventListener("click", () => {
            if (searchBox) searchBox.value = "";
            if (searchBox) searchBox.focus();
            renderDashboard();
        });
    }

    const form = document.getElementById("addBankForm");
    if (form) form.addEventListener("submit", submitBank);

    const topbar = document.getElementById("topbar");
    if (topbar) {
        window.addEventListener(
            "scroll",
            () => {
                topbar.classList.toggle("scrolled", window.scrollY > 8);
            },
            { passive: true }
        );
    }

    /* start — show loading then fetch from backend */
    loading = true;
    showDashboard();
    await reload();
}

init();