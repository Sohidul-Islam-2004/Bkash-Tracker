/* ============================================================
   হাসান ক্যাশ — Simple Ledger
   ============================================================ */

const API_BASE = "";
const API_ROOT = "/api/cash";

let state = {
    balance: 0,
    transactions: []
};

let mutationLock = false;

/* ============================================================
   API & DATA LAYER
   ============================================================ */
async function api(path, options = {}) {
    const url = API_BASE + path;
    const { headers, ...rest } = options;
    try {
        const res = await fetch(url, {
            ...rest,
            headers: { "Content-Type": "application/json", ...(headers || {}) },
        });
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try {
                const body = await res.json();
                if (body && body.message) msg = body.message;
            } catch (_) { }
            throw new Error(msg);
        }
        return await res.json().catch(() => null);
    } catch (err) {
        throw new Error(err.message || "সার্ভারের সাথে সংযোগ করা যায়নি");
    }
}

async function loadData() {
    try {
        const data = await api(API_ROOT);
        if (data) {
            state.balance = data.balance || 0;
            state.transactions = data.transactions || [];
        }
    } catch (err) {
        toast("ডেটা আনতে ব্যর্থ: " + err.message, "error");
    }
    render();
}

async function saveTransaction(txn) {
    try {
        const res = await api(`${API_ROOT}/transactions`, {
            method: "POST",
            body: JSON.stringify(txn),
        });
        if (res && res.transaction) {
            state.transactions.push(res.transaction);
            state.balance = res.balance; // Direct balance update from server
        }
    } catch (err) {
        toast("সেভ করা যায়নি: " + err.message, "error");
        throw err;
    }
}

async function deleteTransaction(id) {
    try {
        const res = await api(`${API_ROOT}/transactions/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });
        state.transactions = state.transactions.filter(t => t.id !== id);
        state.balance = res.balance; // Balance remains unchanged, but we sync anyway
    } catch (err) {
        toast("মুছতে পারা যায়নি: " + err.message, "error");
        throw err;
    }
}

async function updateMainBalance(newBalance) {
    try {
        const res = await api(`${API_ROOT}/balance`, {
            method: "PATCH",
            body: JSON.stringify({ balance: newBalance })
        });
        state.balance = res.balance;
    } catch (err) {
        toast("ব্যালেন্স আপডেট করা যায়নি: " + err.message, "error");
        throw err;
    }
}

async function resetEverything() {
    try {
        const res = await api(`${API_ROOT}/reset`, { method: "DELETE" });
        state.transactions = [];
        state.balance = res.balance;
    } catch (err) {
        toast("রিসেট করা যায়নি: " + err.message, "error");
        throw err;
    }
}

/* ============================================================
   HELPERS
   ============================================================ */
function money(n) {
    const num = Number(n || 0);
    const sign = num < 0 ? "-" : "";
    return sign + "৳" + Math.abs(num).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "numeric", year: "2-digit" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
    document.getElementById("mainBalanceDisplay").textContent = money(state.balance);

    const list = document.getElementById("ledgerList");
    document.getElementById("txnCount").textContent = state.transactions.length.toLocaleString("bn-BD");

    const txns = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (txns.length === 0) {
        list.innerHTML = `<div class="empty"><div class="icon">📭</div><p>এখনো কোনো লেনদেন নেই।</p></div>`;
        return;
    }

    list.innerHTML = txns.map(tx => {
        const isGiven = tx.type === "given";
        return `
            <div class="lg-row">
                <div class="lg-icon ${isGiven ? "given" : "taken"}">
                    ${isGiven ? "↓" : "↑"}
                </div>
                <div class="lg-main">
                    <div class="lg-note">${isGiven ? "হাসান দিয়েছি" : "হাসান পেয়েছি"}</div>
                    ${tx.name ? `<div class="lg-person">👤 ${esc(tx.name)}</div>` : ""}
                    <div class="lg-date">${fmtDate(tx.date)}</div>
                </div>
                               <div class="lg-col ${isGiven ? "lg-out" : "lg-in"}">
                    ${isGiven ? "−" : "+"}${money(tx.amount)}
                </div>
                <button class="tx-del" data-del="${esc(tx.id)}" type="button">✕</button>
            </div>
        `;
    }).join("");

    list.querySelectorAll("[data-del]").forEach(btn => {
        btn.addEventListener("click", () => handleDeleteTxn(btn.dataset.del));
    });
}

/* ============================================================
   INTERACTIONS
   ============================================================ */
async function handleQuickTxn(type) {
    if (mutationLock) return;
    const isGiven = type === "given";

    const result = await askAmount({
        title: isGiven ? "হাসান দিয়েছি" : "হাসান পেয়েছি",
        description: `বর্তমান ব্যালেন্স ${money(state.balance)}`,
        namePlaceholder: isGiven ? "কাকে দিলেন" : "কার থেকে নিলেন",
    });

    if (!result) return;

    mutationLock = true;
    try {
        await saveTransaction({
            type,
            amount: result.amount,
            name: result.name,
            date: new Date().toISOString()
        });
        toast(isGiven ? "দিয়েছি যোগ হয়েছে ✔" : "পেয়েছি যোগ হয়েছে ✔", "success");
        render();
    } catch (err) {
    } finally {
        mutationLock = false;
    }
}

async function handleEditBalance() {
    if (mutationLock) return;

    const newBal = await askBalance({
        title: "মেইন ব্যালেন্স পরিবর্তন",
        current: state.balance
    });

    if (newBal === null || newBal === state.balance) return;

    mutationLock = true;
    try {
        await updateMainBalance(newBal);
        toast("ব্যালেন্স আপডেট হয়েছে ✔", "success");
        render();
    } catch (err) {
    } finally {
        mutationLock = false;
    }
}

async function handleDeleteTxn(id) {
    if (mutationLock) return;
    const ok = await confirmModal({
        title: "লেনদেন মুছে ফেলবেন?",
        description: "মেইন ব্যালেন্স পরিবর্তন হবে না, শুধু লেনদেনটি মুছে যাবে।",
        submitLabel: "মুছুন",
        danger: true,
    });
    if (!ok) return;

    mutationLock = true;
    try {
        await deleteTransaction(id);
        toast("মুছে ফেলা হয়েছে", "success");
        render();
    } catch (err) {
    } finally {
        mutationLock = false;
    }
}

/* ============================================================
   MODALS
   ============================================================ */
function confirmModal({ title, description = "", submitLabel = "হ্যাঁ", danger = false }) {
    return new Promise(resolve => {
        const root = document.getElementById("modalRoot");
        const id = "m" + Date.now();
        root.innerHTML = `
            <div class="modal-bg" id="${id}_bg">
                <div class="modal">
                    <h3>${esc(title)}</h3>
                    <div class="modal-sub">${description}</div>
                    <div class="modal-actions">
                        <button class="btn btn-light" id="${id}_cancel">বাতিল</button>
                        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="${id}_ok">${esc(submitLabel)}</button>
                    </div>
                </div>
            </div>`;
        const cleanup = (val) => { root.innerHTML = ""; resolve(val); };
        document.getElementById(`${id}_bg`).onclick = e => { if (e.target.id === `${id}_bg`) cleanup(false); };
        document.getElementById(`${id}_cancel`).onclick = () => cleanup(false);
        document.getElementById(`${id}_ok`).onclick = () => cleanup(true);
    });
}

function askAmount({ title, description, namePlaceholder }) {
    return new Promise(resolve => {
        const root = document.getElementById("modalRoot");
        const id = "m" + Date.now();
        root.innerHTML = `
            <div class="modal-bg" id="${id}_bg">
                <div class="modal">
                    <h3>${esc(title)}</h3>
                    <div class="modal-sub">${description}</div>
                    <div class="field">
                        <label for="${id}_name">নাম <span class="opt">(ঐচ্ছিক)</span></label>
                        <input id="${id}_name" type="text" placeholder="${esc(namePlaceholder)}" autocomplete="off" />
                    </div>
                    <div class="field">
                        <label for="${id}_amt">টাকার পরিমাণ</label>
                        <div class="money-input">
                            <span class="money-prefix">৳</span>
                            <input id="${id}_amt" type="number" inputmode="numeric" min="1" step="1" placeholder="0" autocomplete="off" />
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-light" id="${id}_cancel">বাতিল</button>
                        <button class="btn btn-primary" id="${id}_ok">যোগ করুন</button>
                    </div>
                </div>
            </div>`;
        const nameInp = document.getElementById(`${id}_name`);
        const amtInp = document.getElementById(`${id}_amt`);
        const cleanup = val => { root.innerHTML = ""; resolve(val); };
        document.getElementById(`${id}_bg`).onclick = e => { if (e.target.id === `${id}_bg`) cleanup(null); };
        document.getElementById(`${id}_cancel`).onclick = () => cleanup(null);
        document.getElementById(`${id}_ok`).onclick = () => {
            const v = Number(amtInp.value);
            if (!v || v <= 0) return amtInp.focus();
            cleanup({ amount: v, name: nameInp.value.trim() || null });
        };
        setTimeout(() => amtInp.focus(), 100);
    });
}

function askBalance({ title, current }) {
    return new Promise(resolve => {
        const root = document.getElementById("modalRoot");
        const id = "m" + Date.now();
        root.innerHTML = `
            <div class="modal-bg" id="${id}_bg">
                <div class="modal">
                    <h3>${esc(title)}</h3>
                    <div class="modal-sub">নতুন মেইন ব্যালেন্স লিখুন</div>
                    <div class="field">
                        <div class="money-input">
                            <span class="money-prefix">৳</span>
                            <input id="${id}_amt" type="number" inputmode="numeric" step="1" value="${current}" autocomplete="off" />
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-light" id="${id}_cancel">বাতিল</button>
                        <button class="btn btn-primary" id="${id}_ok">সেভ করুন</button>
                    </div>
                </div>
            </div>`;
        const amtInp = document.getElementById(`${id}_amt`);
        const cleanup = val => { root.innerHTML = ""; resolve(val); };
        document.getElementById(`${id}_bg`).onclick = e => { if (e.target.id === `${id}_bg`) cleanup(null); };
        document.getElementById(`${id}_cancel`).onclick = () => cleanup(null);
        document.getElementById(`${id}_ok`).onclick = () => {
            const v = Number(amtInp.value);
            if (isNaN(v)) return amtInp.focus();
            cleanup(v);
        };
        setTimeout(() => { amtInp.focus(); amtInp.select(); }, 100);
    });
}

function toast(msg, kind) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = `toast show ${kind || ""}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.className = "toast", 2500);
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-txn]").forEach(btn => {
        btn.addEventListener("click", () => handleQuickTxn(btn.dataset.txn));
    });

    document.getElementById("editBalBtn").addEventListener("click", handleEditBalance);

    document.getElementById("resetBtn").addEventListener("click", async () => {
        const ok = await confirmModal({
            title: "সব ডেটা মুছে ফেলবেন?",
            description: "সব লেনদেন এবং মেইন ব্যালেন্স ০ হয়ে যাবে।",
            submitLabel: "মুছুন",
            danger: true
        });
        if (ok) {
            try {
                await resetEverything();
                toast("সব ডেটা মুছে ফেলা হয়েছে", "success");
                render();
            } catch (err) { }
        }
    });

    loadData();
});

document.getElementById("backBtn").addEventListener("click", () => {
    window.history.back();
});