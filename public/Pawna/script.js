/* ============================================================
   হিসাব — simple ledger (backend-driven)
   All data fetched/saved via REST API. No localStorage.

   Backend endpoints:
     GET    /api/pawna/people                              → { people: [...] }
     POST   /api/pawna/people                              → { person: {...} }
     POST   /api/pawna/people/:id/transactions             → { transaction, summary }
     DELETE /api/pawna/people/:id/transactions/:txnId      → { ok, summary }
     DELETE /api/pawna/people/:id                          → { ok }

   Person shape:
     { id, name, createdAt, summary, transactions: [...] }
   ============================================================ */

/* ------------------------------------------------------------
   CONFIG
------------------------------------------------------------ */
const API_BASE = "";
const API_ROOT = "/api/pawna/people";

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

/* ---- normalize a person from the server ---- */
function normalizePerson(p) {
    if (!p) return null;
    return {
        id: p.id || p._id,
        name: p.name,
        createdAt: p.createdAt || new Date().toISOString(),
        summary: p.summary || null,
        transactions: Array.isArray(p.transactions) ? p.transactions : [],
    };
}

async function fetchPeople() {
    const data = await api(API_ROOT);
    const list = data && Array.isArray(data.people) ? data.people : [];
    return list.map(normalizePerson).filter(Boolean);
}

async function apiCreatePerson({ name }) {
    const data = await api(API_ROOT, {
        method: "POST",
        body: JSON.stringify({ name }),
    });
    if (!data || !data.person) throw new Error("Invalid response");
    return normalizePerson(data.person);
}

async function apiAddTransaction(personId, txn) {
    const data = await api(
        `${API_ROOT}/${encodeURIComponent(personId)}/transactions`,
        {
            method: "POST",
            body: JSON.stringify(txn),
        }
    );

    if (!data || !data.transaction) throw new Error("Invalid response");
    return data;
}

async function apiDeleteTransaction(personId, txnId) {
    return api(
        `${API_ROOT}/${encodeURIComponent(
            personId
        )}/transactions/${encodeURIComponent(txnId)}`,
        { method: "DELETE" }
    );
}

/* ---- delete whole person ---- */
async function apiDeletePerson(personId) {
    return api(`${API_ROOT}/${encodeURIComponent(personId)}`, {
        method: "DELETE",
    });
}

/* ============================================================
   STATE
   ============================================================ */
let db = { people: [] };
let currentView = "viewDashboard";
let currentPersonId = null;
let loading = false;
const { esc, money, toast, fmtDateTime: fmtDate } = App;

/* ============================================================
   DATA LAYER
   ============================================================ */
function getPerson(id) {
    return db.people.find((p) => p.id === id) || null;
}

/* ============================================================
   LEDGER MATH
   ============================================================ */
function totalsOf(p) {
    if (p.summary) {
        const given = Number(p.summary.totalSend ?? p.summary.totalPawna ?? 0);
        const got = Number(p.summary.totalReceive ?? p.summary.totalPaid ?? 0);
        const net = Number(p.summary.net ?? (given - got));
        return { given, got, net };
    }

    let given = 0;
    let got = 0;
    (p.transactions || []).forEach((t) => {
        const a = Number(t.amount || 0);
        if (t.type === "send" || t.type === "pawna") given += a;
        else got += a;
    });
    return { given, got, net: given - got };
}

function applySummary(p, summary) {
    if (!summary) return;
    p.summary = {
        totalSend: Number(summary.totalSend ?? summary.totalPawna ?? 0),
        totalReceive: Number(summary.totalReceive ?? summary.totalPaid ?? 0),
        net: Number(summary.net || 0),
        status: summary.status || "soman",
    };
}

/* ============================================================
   HELPERS
   ============================================================ */
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function balClass(net) {
    return net > 0 ? "pos" : net < 0 ? "neg" : "zero";
}

function balLabel(net) {
    if (net > 0) return "পাওনা";
    if (net < 0) return "দেনা";
    return "মিটমাট";
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

function askAmount({ title, description = "" }) {
    return new Promise((resolve) => {
        const id = "m" + uid();
        const root = document.getElementById("modalRoot");

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
    viewDashboard: "দেনা পাওনা",
    viewAddPerson: "নতুন মানুষ",
    viewPerson: "দেনা পাওনা",
};

function show(id) {
    currentView = id;
    ["viewDashboard", "viewAddPerson", "viewPerson"].forEach((v) =>
        document.getElementById(v).classList.toggle("hidden", v !== id)
    );

    const title = document.getElementById("pageTitle");
    const sub = document.getElementById("pageSub");

    if (title) title.textContent = VIEW_TITLES[id] || "দেনা পাওনা";
    if (sub) {
        sub.textContent =
            id === "viewAddPerson"
                ? "নতুন ব্যক্তি যোগ করুন"
                : id === "viewPerson"
                    ? "লেনদেনের বিস্তারিত"
                    : "কে কত পাবে, কাকে কত দিতে হবে";
    }
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
    const title = document.getElementById("pageTitle");
    if (title) title.textContent = p.name;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
    const grid = document.getElementById("peopleGrid");
    const sb = document.getElementById("searchBar");
    const hero = document.getElementById("dashHero");
    const head = document.getElementById("peopleHead");
    const countEl = document.getElementById("peopleCount");

    const people = db.people;

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
    if (people.length === 0) {
        if (hero) {
            hero.innerHTML = `
                <div class="home-hero">
                    <div class="home-hero-pair">
                        <div class="home-hero-item">
                            <span class="home-hero-label">
                                <span class="home-hero-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h6M9 14h6"/></svg>
                                </span>
                                মোট পাওনা
                            </span>
                            <b class="home-hero-value">৳ 0</b>
                        </div>
                        <div class="home-hero-item home-hero-item--debt">
                            <span class="home-hero-label">
                                <span class="home-hero-ico">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h6M9 14h6"/></svg>
                                </span>
                                মোট দেনা
                            </span>
                            <b class="home-hero-value">৳ 0</b>
                        </div>
                    </div>
                </div>`;
        }
        if (head) head.style.display = "none";
        if (sb) sb.classList.add("solo");
        if (grid) {
            grid.innerHTML = `
                <div class="empty">
                    <div class="icon">📋</div>
                    <h3>এখনো কেউ যোগ করা হয়নি</h3>
                    <p>হিসাব শুরু করতে উপরে "মানুষ যোগ করুন" বাটনে চাপ দিন।</p>
                </div>`;
        }
        return;
    }

    /* -------- totals -------- */
    let receivable = 0;   /* sum of positive nets — they owe me */
    let payable = 0;      /* sum of |negative nets| — I owe them */
    people.forEach((p) => {
        const t = totalsOf(p);
        if (t.net > 0) receivable += t.net;
        else if (t.net < 0) payable += Math.abs(t.net);
    });

    /* -------- hero -------- */
    if (hero) {
        hero.innerHTML = `
            <div class="home-hero">
                <div class="home-hero-pair">
                    <div class="home-hero-item">
                        <span class="home-hero-label">
                            <span class="home-hero-ico">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h6M9 14h6"/></svg>
                            </span>
                            মোট পাওনা
                        </span>
                        <b class="home-hero-value">${money(receivable)}</b>
                    </div>
                    <div class="home-hero-item home-hero-item--debt">
                        <span class="home-hero-label">
                            <span class="home-hero-ico">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                            </span>
                            মোট দেনা
                        </span>
                        <b class="home-hero-value">${money(payable)}</b>
                    </div>
                </div>
            </div>`;
    }

    /* -------- search bar -------- */
    if (sb) sb.classList.remove("solo");

    /* -------- filter -------- */
    const box = document.getElementById("searchBox");
    const q = (box ? box.value : "").trim().toLowerCase();
    const clearBtn = document.getElementById("searchClear");
    if (clearBtn) clearBtn.hidden = !q;

    const list = q
        ? people.filter((p) => (p.name || "").toLowerCase().includes(q))
        : people;

    /* -------- section head -------- */
    if (head) head.style.display = "";
    if (countEl) countEl.textContent = `${list.length} জন`;

    if (list.length === 0) {
        grid.innerHTML = `
            <div class="empty">
                <div class="icon">🔍</div>
                <h3>কাউকে পাওয়া যায়নি</h3>
                <p>অন্য নাম দিয়ে খুঁজুন।</p>
            </div>`;
        return;
    }

    /* -------- cards -------- */
    grid.innerHTML = list
        .map((p, i) => {
            const t = totalsOf(p);
            const count = (p.transactions || []).length;
            const cls = balClass(t.net);
            const label = balLabel(t.net);
            const state = t.net > 0 ? "due" : t.net < 0 ? "debt" : "settled";
            const meta =
                count === 0 ? "কোনো লেনদেন নেই" : `${count}টি লেনদেন`;

            return `
        <article class="person-card" data-state="${state}"
                 style="animation-delay:${Math.min(i, 8) * 40}ms">
            <button class="pc-head" data-open="${p.id}" type="button">
                <div class="pc-info">
                    <h3>${esc(p.name)}</h3>
                    <div class="pc-meta">${meta}</div>
                </div>
                <div class="pc-bal-wrap">
                    <div class="pc-bal bal-${cls}">${money(Math.abs(t.net))}</div>
                    <div class="pc-bal-label">${label}</div>
                </div>
                <span class="pc-chevron">›</span>
            </button>
        </article>`;
        })
        .join("");

    grid.querySelectorAll("[data-open]").forEach((el) => {
        el.addEventListener("click", () => showPerson(el.dataset.open));
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
        db.people = await fetchPeople();
        loading = false;
        if (currentView === "viewPerson" && currentPersonId) {
            renderPerson(currentPersonId);
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
   QUICK TRANSACTION  (type: "send" | "receive")
   ============================================================ */
async function quickTxn(id, type) {
    const p = getPerson(id);
    if (!p) return;
    const isSend = type === "send";
    const t = totalsOf(p);
    const balText =
        t.net === 0 ? "সমান" : `${money(Math.abs(t.net))} ${balLabel(t.net)}`;

    const amount = await askAmount({
        title: isSend ? "নতুন বাকি" : "টাকা পেলাম",
        description: `<b>${esc(p.name)}</b> · এখন ${balText}`,
    });
    if (!amount) return;

    try {
        const data = await apiAddTransaction(id, {
            type,
            amount,
            date: new Date().toISOString(),
        });

        p.transactions = p.transactions || [];
        p.transactions.push(data.transaction);
        applySummary(p, data.summary);

        toast("যোগ হয়েছে ✔", "success");
        if (currentView === "viewPerson") renderPerson(id);
        else renderDashboard();
    } catch (err) {
        toast("সেভ করা যায়নি: " + err.message, "error");
    }
}

/* ============================================================
   PERSON DETAIL — LEDGER (no avatar, with মুছুন option)
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
    const state = t.net > 0 ? "due" : t.net < 0 ? "advance" : "settled";

    const rowsHtml = txns.length
        ? txns
            .map((tx) => {
                const isSend = tx.type === "send" || tx.type === "pawna";
                return `
            <div class="lg-row">
                <div class="lg-icon ${isSend ? "out" : "in"}">
                    ${isSend ? "↓" : "↑"}
                </div>
                <div class="lg-main">
                    <div class="lg-note">${isSend ? "হাসান দিয়েছি" : "হাসান পেয়েছি"}</div>
                    <div class="lg-date">${fmtDate(tx.date)}</div>
                </div>
                <div class="lg-col ${isSend ? "lg-out" : "lg-in"}">
                    ${isSend ? "−" : "+"}${money(tx.amount)}
                </div>
                <button class="tx-del" data-del="${tx.id}" aria-label="মুছুন">✕</button>
            </div>`;
            })
            .join("")
        : `<div class="empty" style="padding:40px 20px;border:0;background:transparent;box-shadow:none">
               <div class="icon">📭</div>
               <p>এখনো কোনো লেনদেন নেই।</p>
           </div>`;

    document.getElementById("personDetail").innerHTML = `
        <div class="person-hero">
            <div class="person-hero-top">
                <div class="person-hero-info">
                    <h2>${esc(p.name)}</h2>
                    <p>${txns.length}টি লেনদেন</p>
                </div>
                <button class="person-del" type="button" data-del-person="${p.id}"
                        aria-label="ব্যক্তিকে মুছুন" title="মুছুন">
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

            <div class="person-hero-bal">
            
                <b class="ph-bal">${money(Math.abs(t.net))}</b>
                <span class="ph-state">${label}</span>
            </div>
        </div>

        <div class="panel">
            <div class="sum-grid">
                <div class="sum-item sum-item--out">
                    <span class="sum-label">মোট দিয়েছি</span>
                    <span class="sum-value">${money(t.given)}</span>
                </div>
                <div class="sum-item sum-item--in">
                    <span class="sum-label">মোট পেয়েছি</span>
                    <span class="sum-value">${money(t.got)}</span>
                </div>
            </div>

            

            <div class="detail-actions">
                <button class="pc-btn pc-send" data-txn="send" data-id="${p.id}">
                    ↓ হাসান  দিয়েছি
                </button>
                <button class="pc-btn pc-receive" data-txn="receive" data-id="${p.id}">
                    ↑ হাসান  পেয়েছি
                </button>
            </div>
        </div>

        <div class="panel lg-panel">
            <div class="section-head" style="margin:0 0 12px">
                <h2 class="section-title"><span class="title-dot"></span>হিসাব</h2>
                <span class="section-count">${txns.length}</span>
            </div>
            ${rowsHtml}
        </div>
    `;

    /* -------- wire up events -------- */
    const detail = document.getElementById("personDetail");

    detail.querySelectorAll("[data-txn]").forEach((el) => {
        el.addEventListener("click", () => quickTxn(el.dataset.id, el.dataset.txn));
    });

    detail.querySelectorAll("[data-del]").forEach((el) => {
        el.addEventListener("click", () => deleteTxn(p.id, el.dataset.del));
    });

    detail.querySelectorAll("[data-del-person]").forEach((el) => {
        el.addEventListener("click", () => deletePerson(el.dataset.delPerson));
    });
}

/* ============================================================
   DELETE PERSON (whole record)
   ============================================================ */
async function deletePerson(personId) {
    const p = getPerson(personId);
    if (!p) return;

    const count = (p.transactions || []).length;
    const t = totalsOf(p);
    const balText =
        t.net === 0 ? "সমান" : `${money(Math.abs(t.net))} ${balLabel(t.net)}`;

    const ok = await confirmModal({
        title: "মুছে ফেলবেন?",
        description:
            `<b>${esc(p.name)}</b> কে সম্পূর্ণভাবে মুছে ফেলা হবে।` +
            (count
                ? ` তার <b>${count}টি</b> লেনদেনের হিসাবও (বর্তমান ব্যালেন্স <b>${balText}</b>) মুছে যাবে।`
                : "") +
            `<br><br>এই কাজটি ফিরিয়ে আনা যাবে না।`,
        submitLabel: "মুছুন",
        cancelLabel: "বাতিল",
        danger: true,
    });
    if (!ok) return;

    const btns = document.querySelectorAll(
        `[data-del-person="${CSS.escape(String(personId))}"]`
    );
    btns.forEach((b) => (b.disabled = true));

    try {
        await apiDeletePerson(personId);

        db.people = db.people.filter((x) => x.id !== personId);
        currentPersonId = null;

        toast(`${p.name} মুছে ফেলা হয়েছে`, "success");
        showDashboard();
    } catch (err) {
        btns.forEach((b) => (b.disabled = false));
        toast("মুছতে পারা যায়নি: " + err.message, "error");
    }
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

    const p = getPerson(personId);
    if (!p) return;

    const idx = (p.transactions || []).findIndex((t) => t.id === txnId);
    if (idx < 0) return;
    const removed = p.transactions[idx];

    try {
        const data = await apiDeleteTransaction(personId, txnId);

        p.transactions.splice(idx, 1);
        if (data && data.summary) applySummary(p, data.summary);
        else p.summary = null;

        if (currentView === "viewPerson") renderPerson(personId);
        else renderDashboard();

    } catch (err) {
        toast("মুছতে পারা যায়নি: " + err.message, "error");
    }
}

/* ============================================================
   SUBMIT PERSON
   ============================================================ */
async function submitPerson(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    const amount = Number(f.get("amount")) || 0;

    if (!name) {
        toast("নাম লিখুন", "error");
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "সেভ হচ্ছে…";
    }

    try {
        const p = await apiCreatePerson({ name });
        db.people.push(p);

        /* Starting amount = they owe me → a "send" entry */
        if (amount > 0) {
            const data = await apiAddTransaction(p.id, {
                type: "send",
                amount,
                date: new Date().toISOString(),
                notes: "শুরুর বাকি",
            });
            p.transactions.push(data.transaction);
            applySummary(p, data.summary);
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

App.lockZoomAndCopy();

/* ============================================================
   INIT
   ============================================================ */
async function init() {
    /* back button */
    const backBtn = document.getElementById("backBtn");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            if (
                currentView === "viewAddPerson" ||
                currentView === "viewPerson"
            ) {
                showDashboard();
                return;
            }
            window.location.href = "/";
        });
    }

    /* add person */
    const addBtn = document.getElementById("addPersonBtn");
    if (addBtn) addBtn.addEventListener("click", showAddPerson);

    /* search */
    const searchBox = document.getElementById("searchBox");

    if (searchBox) searchBox.addEventListener("input", renderDashboard);

    /* form */
    const form = document.getElementById("addPersonForm");
    if (form) form.addEventListener("submit", submitPerson);

    /* start — show loading then fetch from backend */
    loading = true;
    showDashboard();
    await reload();
}

init();