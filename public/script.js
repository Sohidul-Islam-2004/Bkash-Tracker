/* ============================================================
   LIMITS
   ============================================================ */
const DAILY_LIMIT = 50000;
const MONTHLY_LIMIT = 300000;

/* ============================================================
   STATE
   ============================================================ */
let db = { people: [] };
let historyOpen = false;
let pendingPhotoDataUrl = null;

/* ============================================================
   API HELPERS
   ============================================================ */
async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
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
   NORMALIZE (_id → id)
   ============================================================ */
function normalizePerson(p) {
    return {
        ...p,
        id: p._id || p.id,
        transactions: (p.transactions || []).map(t => ({
            ...t,
            id: t._id || t.id
        }))
    };
}

async function refreshPeople() {
    const list = await api("/api/people");
    db.people = list.map(normalizePerson);
}

async function refreshPerson(id) {
    const p = await api("/api/people/" + id);
    const np = normalizePerson(p);
    const idx = db.people.findIndex(x => x.id === id);
    if (idx >= 0) db.people[idx] = { ...db.people[idx], ...np };
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
        "exceeds daily limit": "আজকের সীমা পার হয়ে যাবে",
        "exceeds monthly limit": "এই মাসের সীমা পার হয়ে যাবে",
        "amount must be > 0": "টাকার পরিমাণ লিখুন",
        "Amount must be more than 0": "টাকার পরিমাণ লিখুন",
        "type must be send or receive": "ধরন ঠিক নয়",
        "Invalid transaction type": "ধরন ঠিক নয়",
        "person not found": "মানুষ খুঁজে পাওয়া যায়নি",
        "Person not found": "মানুষ খুঁজে পাওয়া যায়নি",
        "photo upload failed": "ছবি আপলোড হয়নি",
        "Invalid id": "ভুল আইডি",
        "Transaction not found": "লেনদেন খুঁজে পাওয়া যায়নি",
        "This bKash number is already added": "এই বিকাশ নম্বর আগেই যোগ করা আছে",
        "not enough balance": "ব্যালেন্স নেই — টাকা পাঠানো যাবে না"
    };
    for (const k in map) {
        if (text.includes(k)) return map[k];
    }
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
    return "৳" + num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
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
        .map(w => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
}

function dayKey(d = new Date()) {
    return (
        d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getDate()).padStart(2, "0")
    );
}

function monthKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

/* Keep the local 01XXXXXXXXX format — no 88 prefix */
function normalizeWa(num) {
    return String(num || "").replace(/\D/g, "");
}

function localNow() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

/* ============================================================
   SUMMARY — reads stored values directly from the server
   The server maintains initialBalance and used counters.
   ============================================================ */
function summarize(p) {
    const now = new Date();
    const tKey = dayKey(now);
    const mKey = monthKey(now);

    const dailyUsed =
        p.baseDayKey === tKey ? Number(p.dailyUsedBase || 0) : 0;
    const monthlyUsed =
        p.baseMonthKey === mKey ? Number(p.monthlyUsedBase || 0) : 0;

    const balance = Number(p.initialBalance || 0);
    const remDaily = DAILY_LIMIT - dailyUsed;
    const remMonthly = MONTHLY_LIMIT - monthlyUsed;

    const worst = Math.min(
        DAILY_LIMIT > 0 ? remDaily / DAILY_LIMIT : 1,
        MONTHLY_LIMIT > 0 ? remMonthly / MONTHLY_LIMIT : 1
    );

    return {
        balance,
        dailyUsed,
        monthlyUsed,
        remDaily,
        remMonthly,
        status: worst < 0.2 ? "red" : worst < 0.5 ? "yellow" : "green"
    };
}

/* ============================================================
   CHECK IF SEND IS ALLOWED
   ============================================================ */
function checkSend(p, amount, when = new Date()) {
    const now = new Date();
    const tKey = dayKey(now);
    const mKey = monthKey(now);

    const balance = Number(p.initialBalance || 0);
    const curDaily =
        p.baseDayKey === tKey ? Number(p.dailyUsedBase || 0) : 0;
    const curMonthly =
        p.baseMonthKey === mKey ? Number(p.monthlyUsedBase || 0) : 0;

    if (balance <= 0) return "ব্যালেন্স নেই — টাকা পাঠানো যাবে না";
    if (amount > balance) return "ব্যালেন্স কম — আছে মাত্র " + money(balance);

    const remD = DAILY_LIMIT - curDaily;
    const remM = MONTHLY_LIMIT - curMonthly;

    if (remD <= 0) return "আজকের সীমা শেষ — টাকা পাঠানো যাবে না";
    if (amount > remD) return "আজকের সীমা পার হয়ে যাবে — বাকি " + money(remD);
    if (remM <= 0) return "এই মাসের সীমা শেষ — টাকা পাঠানো যাবে না";
    if (amount > remM) return "এই মাসের সীমা পার হয়ে যাবে — বাকি " + money(remM);

    return null;
}

/* ============================================================
   BUILD WHATSAPP MESSAGE
   — Adds "send from your bKash" line only when
     the WhatsApp number differs from the bKash number.
   ============================================================ */

/* ============================================================
   PAGE ROUTING
   ============================================================ */
function show(id) {
    ["viewDashboard", "viewAddPerson", "viewPerson"].forEach(v =>
        document.getElementById(v).classList.toggle("hidden", v !== id)
    );
    window.scrollTo(0, 0);
}

async function showDashboard() {
    try {
        await refreshPeople();
    } catch (e) {
        toast("সার্ভারে সংযোগ হয়নি", "error");
    }
    renderDashboard();
    show("viewDashboard");
}

function showAddPerson() {
    resetPhotoPicker();
    show("viewAddPerson");
}

async function showPerson(id) {
    try {
        await refreshPerson(id);
    } catch (e) {
        toast("লোড হয়নি: " + translateError(e.message), "error");
        return;
    }
    renderPerson(id);
    show("viewPerson");
}

/* ============================================================
   WHATSAPP LINK
   ============================================================ */
function openWhatsApp(waNumber, message) {
    let num = String(waNumber || "").replace(/\D/g, "");

    // Add Bangladesh country code only for the wa.me link
    if (num.startsWith("01") && num.length === 11) num = "88" + num;

    const text = encodeURIComponent(message);
    window.open(`https://wa.me/${num}?text=${text}`, "_blank");
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
    const img = document.getElementById("brandLogo");
    img.src = DEFAULT_LOGO;
}

/* ============================================================
   PHOTO PICKER
   ============================================================ */
function resetPhotoPicker() {
    pendingPhotoDataUrl = null;
    const preview = document.getElementById("photoPreview");
    const fallback = document.getElementById("photoFallback");
    if (preview) {
        preview.src = "";
        preview.classList.add("hidden");
    }
    if (fallback) fallback.classList.remove("hidden");
    const fi = document.querySelector('input[name="photo"]');
    if (fi) fi.value = "";
}

function previewPhoto(e) {
    const file = e.target.files[0];
    if (!file) {
        resetPhotoPicker();
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const size = 200;
            const c = document.createElement("canvas");
            c.width = size;
            c.height = size;
            const ctx = c.getContext("2d");
            const scale = Math.max(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
            pendingPhotoDataUrl = c.toDataURL("image/jpeg", 0.85);

            const preview = document.getElementById("photoPreview");
            const fallback = document.getElementById("photoFallback");
            preview.src = pendingPhotoDataUrl;
            preview.classList.remove("hidden");
            fallback.classList.add("hidden");
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

function avatarHTML(person, sizeClass) {
    if (person.photo) {
        return `<img class="avatar ${sizeClass}" src="${esc(person.photo)}" alt="${esc(
            person.name
        )}" />`;
    }
    return `<div class="avatar ${sizeClass}">${initialsOf(person.name)}</div>`;
}

/* ============================================================
   MODALS
   ============================================================ */
function showModal({
    title,
    description = "",
    fields,
    submitLabel = "ঠিক আছে",
    cancelLabel = "বাতিল"
}) {
    return new Promise(resolve => {
        const modalId = "m" + uid();
        const fieldsHtml = fields
            .map(
                f => `
            <div class="field">
                <label>${esc(f.label)}</label>
                <input id="${modalId}_${f.id}"
                       type="${f.type || "text"}"
                       value="${f.value ?? ""}"
                       placeholder="${esc(f.placeholder || "")}"
                       inputmode="${f.inputmode || "text"}" />
            </div>
        `
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
        const cleanup = result => {
            document.getElementById("modalRoot").innerHTML = "";
            resolve(result);
        };

        bg.addEventListener("click", e => {
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
            if (fields[0]) {
                document.getElementById(`${modalId}_${fields[0].id}`).focus();
            }
        }, 60);
    });
}

function confirmModal({
    title,
    description,
    submitLabel = "হ্যাঁ",
    cancelLabel = "না"
}) {
    return new Promise(resolve => {
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
        const cleanup = result => {
            document.getElementById("modalRoot").innerHTML = "";
            resolve(result);
        };

        bg.addEventListener("click", e => {
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
        ? db.people.filter(
            p =>
                (p.name || "").toLowerCase().includes(q) ||
                (p.bkashNumber || "").includes(q)
        )
        : db.people;

    if (list.length === 0) {
        grid.innerHTML = `
            <div class="empty" style="grid-column:1/-1">
                <div class="icon">🔍</div>
                <h3>কাউকে পাওয়া যায়নি</h3>
                <p>অন্য নাম বা নম্বর লিখে দেখুন।</p>
            </div>`;
        return;
    }

    const bar = (rem, limit) => {
        const used = Math.max(0, Math.min(100, ((limit - rem) / limit) * 100));
        const color =
            rem <= 0 ? "#b3122f" : used >= 70 ? "#f59e0b" : "#16a34a";
        return `<div class="bar"><span style="width:${used}%;background:${color}"></span></div>`;
    };

    grid.innerHTML = list
        .map((p, i) => {
            const s = summarize(p);
            const blocked = s.remDaily <= 0 || s.remMonthly <= 0;

            return `
            <div class="person ${blocked ? "blocked" : ""}"
                 onclick="showPerson('${p.id}')"
                 style="animation-delay:${Math.min(i, 8) * 40}ms">

                <div class="p-top">
                    ${avatarHTML(p, "avatar-sm")}
                    <div class="p-name">
                        <h3>
                            ${esc(p.name)}
                            ${blocked ? '<span class="block-badge">সীমা শেষ</span>' : ""}
                        </h3>
                        <div class="num">${esc(p.bkashNumber)}</div>
                    </div>
                    <div class="p-bal">${money(s.balance)}</div>
                </div>

                <div class="p-limits">
                    <div>
                        <div class="limit-row">
                            <span>দৈনিক লিমিট</span>
                            <b class="${s.remDaily <= 0 ? "over" : ""}">${money(s.remDaily)}</b>
                        </div>
                        ${bar(s.remDaily, DAILY_LIMIT)}
                    </div>
                    <div>
                        <div class="limit-row">
                            <span>মাসিক লিমিট</span>
                            <b class="${s.remMonthly <= 0 ? "over" : ""}">${money(s.remMonthly)}</b>
                        </div>
                        ${bar(s.remMonthly, MONTHLY_LIMIT)}
                    </div>
                </div>
            </div>`;
        })
        .join("");
}

/* ============================================================
   PERSON DETAIL
   ============================================================ */
function renderPerson(id, all) {
    const p = db.people.find(x => x.id === id);
    if (!p) {
        showDashboard();
        return;
    }

    const s = summarize(p);
    const txns = [...(p.transactions || [])].sort(
        (a, b) => new Date(b.date) - new Date(a.date)
    );

    const visible = all ? txns : txns.slice(0, 10);

    const dailyBlocked = s.remDaily <= 0;
    const monthlyBlocked = s.remMonthly <= 0;
    const blocked = dailyBlocked || monthlyBlocked;
    const noBalance = s.balance <= 0;
    const msgBlocked = blocked || noBalance || !p.whatsappNumber;

    const warnings = [];
    if (noBalance)
        warnings.push(
            "ব্যালেন্স নেই — টাকা পাঠানো বা মেসেজ পাঠানো যাবে না। রিসিভ করা যাবে।"
        );
    if (dailyBlocked)
        warnings.push(
            "আজকের সীমা শেষ — টাকা পাঠানো বা মেসেজ পাঠানো যাবে না। রিসিভ করা যাবে।"
        );
    if (monthlyBlocked)
        warnings.push(
            "এই মাসের সীমা শেষ — টাকা পাঠানো বা মেসেজ পাঠানো যাবে না। রিসিভ করা যাবে।"
        );

    document.getElementById("personDetail").innerHTML = `

        <!-- HEADER CARD -->
        <div class="panel">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:6px">
                ${avatarHTML(p, "avatar-lg")}
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;">
                    <h2 style="margin:0 0 2px;display:block;font-size:22px">${esc(p.name)}</h2>
                    
                    <!-- Normalized bkash number layout -->
                    <div style="color:var(--muted);font-size:15px;display:flex;align-items:center;gap:6px;line-height:1.2;">
                        <span>বিকাশ:</span> 
                        <span class="detail-phone-num">${esc(p.bkashNumber)}</span>
                    </div>
                    
                    <!-- Normalized whatsapp number layout matching the size of bkash -->
                    ${p.whatsappNumber
            ? `<div style="color:var(--muted);font-size:15px;display:flex;align-items:center;gap:6px;line-height:1.2;">
                        <span>হোয়াটসঅ্যাপ:</span> 
                        <span class="detail-phone-num">${esc(p.whatsappNumber)}</span>
                       </div>`
            : ""
        }
                </div>
            </div>

            ${warnings.length
            ? `<div class="warn" style="margin-top:16px">
                           <span style="font-size:20px">⚠️</span>
                           <div>${warnings.join(" ")}</div>
                       </div>`
            : ""
        }

            <div class="stats" style="margin-top:18px">
                <div class="stat">
                    <div class="lbl">ব্যালেন্স</div>
                    <div class="val">${money(s.balance)}</div>
                </div>
                <div class="stat">
                    <div class="lbl">দৈনিক লিমিট</div>
                    <div class="val" style="${dailyBlocked ? "color:#b3122f" : ""}">${money(
            s.remDaily
        )}</div>
                    <div class="sub">খরচ ${money(s.dailyUsed)} / ${money(DAILY_LIMIT)}</div>
                </div>
                <div class="stat">
                    <div class="lbl">মাসিক লিমিট</div>
                    <div class="val" style="${monthlyBlocked ? "color:#b3122f" : ""}">${money(
            s.remMonthly
        )}</div>
                    <div class="sub">খরচ ${money(s.monthlyUsed)} / ${money(MONTHLY_LIMIT)}</div>
                </div>
            </div>

            <div class="toolbar" style="margin-top:18px">
                <button class="btn ${msgBlocked ? "btn-muted" : "btn-wa"} btn-sm"
                        onclick="openWaModal('${p.id}')">
                    ${msgBlocked ? "🚫 মেসেজ পাঠানো বন্ধ" : "📱 ম্যাসাজ পাঠান"}
                </button>
                <button class="btn btn-light btn-sm" onclick="changePersonPhoto('${p.id}')">📷 ছবি পরিবর্তন</button>
                <button class="btn btn-light btn-sm" onclick="editUsed('${p.id}')">✏️ লিমিট ঠিক করুন</button>
                <button class="btn btn-danger btn-sm" onclick="deletePerson('${p.id}')">🗑 মুছুন</button>
            </div>
        </div>

        <!-- ADD TRANSACTION -->
        <details class="panel fold">
            <summary>➕ নতুন লেনদেন</summary>
            <form onsubmit="submitTransaction(event, '${p.id}')">
                <div class="row">
                    <div class="field">
                        <label>কী হয়েছে?</label>
                        <select name="type" required>
                            <option value="send">সেন্ড মানি</option>
                            <option value="receive">রিসিভ মানি</option>
                        </select>
                    </div>
                    <div class="field">
                        <label>কত টাকা?</label>
                        <input name="amount" type="number" min="1" step="1" required
                               placeholder="0" inputmode="numeric" />
                    </div>
                    <div class="field">
                        <label>কার সাথে? (না দিলেও চলবে)</label>
                        <input name="counterparty" placeholder="নাম বা নম্বর" />
                    </div>
                    <div class="field">
                        <label>কখন?</label>
                        <input name="date" type="datetime-local" value="${localNow()}" />
                    </div>
                </div>

                <div class="field">
                    <label>নোট (না দিলেও চলবে)</label>
                    <input name="notes" placeholder="মনে রাখার মতো কিছু" />
                </div>

                <button class="btn btn-primary btn-block btn-xl" type="submit">✔ যোগ করুন</button>
            </form>
        </details>

        <!-- HISTORY -->
        <details class="panel fold" ${historyOpen || all ? "open" : ""} ontoggle="historyOpen=this.open">
            <summary>📜 সব লেনদেন (${txns.length})</summary>
            <div class="fold-body">
                ${txns.length === 0
            ? `<div class="empty" style="padding:40px 20px">
                               <div class="icon">📭</div>
                               <p>এখনো কোনো লেনদেন নেই।</p>
                           </div>`
            : renderTxList(
                p.id,
                visible,
                txns.length > visible.length,
                txns.length - visible.length
            )
        }
            </div>
        </details>
    `;
}


/* ============================================================
   TRANSACTION LIST
 /* ============================================================ */
function renderTxList(personId, txns, hasMore, remaining) {
    const rows = txns
        .map(t => {
            const typeClass = t.type === "send" ? "send" : "receive";
            const typeLabel = t.type === "send" ? "সেন্ড মানি" : "রিসিভ মানি";

            // --- UPDATED DATE & TIME FORMATTING ---
            const d = new Date(t.date);
            const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "numeric", year: "numeric" });
            const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
            // --------------------------------------

            const counterpartyHtml = t.counterparty ? `<span class="tx-counterparty">${esc(t.counterparty)}</span>` : `<span class="tx-counterparty tx-empty">—</span>`;
            const notesHtml = t.notes ? `<div class="tx-notes">📝 ${esc(t.notes)}</div>` : "";

            return `
        <div class="tx-item">
          <div class="tx-row">
            <span class="tag ${typeClass}">${typeLabel}</span>
            ${counterpartyHtml}
            <span class="tx-amount ${typeClass}">${money(t.amount)}</span>
            <button class="tx-del" onclick="deleteTxn('${personId}','${t.id}')" aria-label="মুছুন">✕</button>
          </div>
          <!-- Applied the "--" separator here -->
          <div class="tx-date">${dateStr} -- ${timeStr}</div> 
          ${notesHtml}
        </div>`;
        })
        .join("");

    const moreBtn = hasMore ? `<button class="btn btn-light btn-block" style="margin-top:12px" onclick="renderPerson('${personId}', true)"> আরও দেখুন (${remaining}) </button>` : "";
    return `<div class="tx-list">${rows}</div>${moreBtn}`;
}


/* ============================================================
   WHATSAPP MODAL — send message section
   ============================================================ */
function buildWaMessage(p, amount, dest, waNumber) {
    let msg = `আপনার বিকাশ নম্বর (${p.bkashNumber}) থেকে \n\nএই ${dest} নম্বরে ${money(amount)} টাকা বিকাশ সেন্ড মানি করুন।`;

    return msg;
}

function openWaModal(personId) {
    const p = db.people.find(x => x.id === personId);
    if (!p) return;

    const s = summarize(p);

    if (s.remDaily <= 0) {
        toast("আজকের সীমা শেষ — মেসেজ পাঠানো যাবে না", "error");
        return;
    }
    if (s.remMonthly <= 0) {
        toast("এই মাসের সীমা শেষ — মেসেজ পাঠানো যাবে না", "error");
        return;
    }
    if (s.balance <= 0) {
        toast("ব্যালেন্স নেই — মেসেজ পাঠানো যাবে না", "error");
        return;
    }
    if(!p.whatsappNumber)
    {
        toast("হোয়াটস্যাপ নম্বর নেই — মেসেজ পাঠানো যাবে না", "error");
        return;
    }

    /* WhatsApp number comes from the person's saved data */
    const waNumber = p.whatsappNumber
        ? normalizeWa(p.whatsappNumber)
        : normalizeWa(p.bkashNumber);

    if (!waNumber || waNumber.length < 11) {
        toast("এই মানুষের হোয়াটসঅ্যাপ নম্বর নেই — আগে যোগ করুন", "error");
        return;
    }



    document.getElementById("modalRoot").innerHTML = `
        <div class="modal-bg" onclick="if(event.target===this)closeModal()">
            <div class="modal">
                <h3>📱 হোয়াটসঅ্যাপে টাকা চান</h3>
                <div class="modal-sub"><b>${esc(p.name)}</b> কে মেসেজ পাঠানো হবে</div>

                <div class="field">
                    <label>কত টাকা?</label>
                    <input id="waAmount" type="number" min="1" step="1"
                           placeholder="5000" inputmode="numeric" />
                </div>

                <div class="field">
                    <label>বিকাশ নম্বর?</label>
                    <input id="waDest" value="" inputmode="numeric" />
                </div>

                <label style="margin-top:8px">যে মেসেজ যাবে</label>
                <div class="preview-msg" id="waPreview"></div>

                <div class="modal-actions">
                    <button class="btn btn-light" onclick="closeModal()">বাতিল</button>
                    <button class="btn btn-wa" onclick="sendWaMessage('${p.id}')">পাঠান</button>
                </div>
            </div>
        </div>`;

    const update = () => {
        const amt = Number(document.getElementById("waAmount").value) || 0;
        const dest = document.getElementById("waDest").value || "";
        document.getElementById("waPreview").textContent =
            buildWaMessage(p, amt, dest, waNumber);
    };

    ["waAmount", "waDest"].forEach(id => {
        document.getElementById(id).addEventListener("input", update);
    });

    update();
    setTimeout(() => document.getElementById("waAmount").focus(), 60);
}

function closeModal() {
    document.getElementById("modalRoot").innerHTML = "";
}

function sendWaMessage(personId) {
    const p = db.people.find(x => x.id === personId);
    if (!p) return;

    const s = summarize(p);
    if (s.remDaily <= 0) {
        toast("আজকের সীমা শেষ — মেসেজ পাঠানো যাবে না", "error");
        return;
    }
    if (s.remMonthly <= 0) {
        toast("এই মাসের সীমা শেষ — মেসেজ পাঠানো যাবে না", "error");
        return;
    }

    const amount = Number(document.getElementById("waAmount").value);
    const dest = document.getElementById("waDest").value.trim();

    /* WhatsApp number from the person's saved data */
    const waNumber = p.whatsappNumber
        ? normalizeWa(p.whatsappNumber)
        : normalizeWa(p.bkashNumber);

    if (!amount || amount <= 0) {
        toast("টাকার পরিমাণ লিখুন", "error");
        return;
    }
    if (!dest) {
        toast("বিকাশ নম্বর লিখুন", "error");
        return;
    }
    if (!waNumber || waNumber.length < 11) {
        toast("হোয়াটসঅ্যাপ নম্বর ঠিক নয়", "error");
        return;
    }

    if (amount > s.remDaily) {
        toast("আজকের সীমার চেয়ে বেশি — মেসেজ পাঠানো যাবে না", "error");
        return;
    }
    if (amount > s.remMonthly) {
        toast("এই মাসের সীমার চেয়ে বেশি — মেসেজ পাঠানো যাবে না", "error");
        return;
    }
    if (amount > s.balance) {
        toast("ব্যালেন্স কম — আছে মাত্র " + money(s.balance), "error");
        return;
    }

    const msg = buildWaMessage(p, amount, dest, waNumber);
    openWhatsApp(waNumber, msg);
    toast("হোয়াটসঅ্যাপ খোলা হয়েছে", "success");
    closeModal();
}

/* ============================================================
   SUBMIT PERSON
   ============================================================ */
async function submitPerson(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = k => Number(f.get(k)) || 0;

    const fi = e.target.querySelector('input[name="photo"]');
    const photoFile = fi && fi.files ? fi.files[0] : null;

    const fd = new FormData();
    fd.append("name", f.get("name").trim());
    fd.append("bkashNumber", f.get("bKashNumber").trim());
    fd.append("whatsappNumber", normalizeWa(f.get("whatsappNumber")) || "");
    fd.append("initialBalance", num("initialBalance"));
    fd.append("dailyUsedBase", num("dailyUsedBase"));
    fd.append("monthlyUsedBase", num("monthlyUsedBase"));
    fd.append("baseDayKey", dayKey());
    fd.append("baseMonthKey", monthKey());
    if (photoFile) fd.append("photo", photoFile);

    try {
        await apiForm("/api/people", { formData: fd });
        e.target.reset();
        resetPhotoPicker();
        toast("যোগ হয়েছে ✔", "success");
        await showDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   SUBMIT TRANSACTION
   ============================================================ */
async function submitTransaction(e, personId) {
    e.preventDefault();
    const p = db.people.find(x => x.id === personId);
    if (!p) return;

    const f = new FormData(e.target);
    const type = f.get("type");
    const amount = Number(f.get("amount"));
    if (!amount || amount <= 0) {
        toast("টাকার পরিমাণ লিখুন", "error");
        return;
    }

    const dateVal = f.get("date");
    const when = dateVal ? new Date(dateVal) : new Date();
    const date = when.toISOString();

    /* Only send checks — receive always allowed */
    if (type === "send") {
        const err = checkSend(p, amount, when);
        if (err) {
            toast(err, "error");
            return;
        }
    }

    try {
        await api(`/api/transactions/${personId}`, {
            method: "POST",
            body: {
                type,
                amount,
                date,
                counterparty: (f.get("counterparty") || "").trim() || null,
                notes: (f.get("notes") || "").trim() || null
            }
        });
        await refreshPerson(personId);
        toast("যোগ হয়েছে ✔", "success");
        renderPerson(personId);
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   DELETE
   ============================================================ */
async function deleteTxn(personId, txnId) {
    const ok = await confirmModal({
        title: "মুছে ফেলবেন?",
        description:
            "এই লেনদেনটি চিরতরে মুছে যাবে। ব্যালেন্স বা সীমার হিসাব বদলাবে না।",
        submitLabel: "হ্যাঁ, মুছুন"
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
    const p = db.people.find(x => x.id === id);
    if (!p) return;

    const ok = await confirmModal({
        title: `${esc(p.name)} কে মুছবেন?`,
        description: "এই মানুষের সব লেনদেনও মুছে যাবে।",
        submitLabel: "হ্যাঁ, মুছুন"
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
   EDIT USED AMOUNTS
   ============================================================ */
async function editUsed(id) {
    const p = db.people.find(x => x.id === id);
    if (!p) return;

    const result = await showModal({
        title: "খরচ ঠিক করুন",
        description: "এখন পর্যন্ত কত টাকা পাঠানো হয়েছে সেটা লিখুন।",
        fields: [
            {
                id: "du",
                label: "আজ পাঠানো হয়েছে",
                type: "number",
                inputmode: "numeric",
                value: p.dailyUsedBase || 0
            },
            {
                id: "mu",
                label: "এই মাসে পাঠানো হয়েছে",
                type: "number",
                inputmode: "numeric",
                value: p.monthlyUsedBase || 0
            }
        ],
        submitLabel: "✔ সংরক্ষণ"
    });
    if (!result) return;

    const du = Number(result.du);
    const mu = Number(result.mu);
    if (isNaN(du) || du < 0 || isNaN(mu) || mu < 0) {
        toast("সঠিক সংখ্যা লিখুন", "error");
        return;
    }

    try {
        await api("/api/people/" + id, {
            method: "PATCH",
            body: {
                dailyUsedBase: du,
                monthlyUsedBase: mu,
                baseDayKey: dayKey(),
                baseMonthKey: monthKey()
            }
        });
        await refreshPerson(id);
        toast("সংরক্ষণ হয়েছে ✔", "success");
        renderPerson(id);
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ============================================================
   CHANGE PERSON PHOTO
   ============================================================ */
function changePersonPhoto(id) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        const fd = new FormData();
        fd.append("photo", file);

        try {
            await apiForm("/api/people/" + id, {
                method: "PATCH",
                formData: fd
            });
            await refreshPerson(id);
            toast("ছবি বদলানো হয়েছে ✔", "success");
            renderPerson(id);
        } catch (err) {
            toast(translateError(err.message), "error");
        }
    };
    input.click();
}

/* ============================================================
   EXPORT CSV
   ============================================================ */
async function exportCSV() {
    toast("তৈরি হচ্ছে...");
    const rows = [
        ["নাম", "বিকাশ নম্বর", "ধরন", "টাকা", "তারিখ", "কার সাথে", "নোট"]
    ];

    try {
        for (const person of db.people) {
            const full = await api("/api/people/" + person.id);
            (full.transactions || []).forEach(t => {
                rows.push([
                    person.name,
                    person.bkashNumber,
                    t.type === "send" ? "পাঠানো" : "পাওয়া",
                    t.amount,
                    new Date(t.date).toLocaleString("bn-BD"),
                    t.counterparty || "",
                    t.notes || ""
                ]);
            });
        }
    } catch (err) {
        toast("এক্সপোর্ট ব্যর্থ", "error");
        return;
    }

    if (rows.length === 1) {
        toast("এক্সপোর্ট করার মতো কিছু নেই", "error");
        return;
    }

    const csv = rows
        .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
        type: "text/csv;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `বিকাশ-হিসাব-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("ডাউনলোড হয়েছে ✔", "success");
}

/* ============================================================
   INIT
   ============================================================ */
renderLogo();
showDashboard();