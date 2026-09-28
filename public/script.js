/* ======================================================
   নির্দিষ্ট সীমা
   ====================================================== */
const DAILY_LIMIT = 50000;
const MONTHLY_LIMIT = 300000;

/* ======================================================
   API configuration
   ====================================================== */
const API_BASE = "http://localhost:3000";

/* ---------------- lokар storage (শুধু লোগো + pending request) ---------------- */
const LOCAL_KEY = "bkash_tracker_local_v1";
let local = { logo: null, pending: {} };
let db = { people: [] };

function loadLocal() {
    try {
        const raw = localStorage.getItem(LOCAL_KEY);
        if (raw) local = JSON.parse(raw);
    } catch (e) { console.warn("লোকাল লোড হয়নি", e); }
    if (!local.pending) local.pending = {};
}
function saveLocal() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
}

/* ---------------- API helper ---------------- */
async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(API_BASE + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Server error");
    return data;
}

function normalizePerson(p) {
    return {
        ...p,
        id: p._id,
        transactions: (p.transactions || []).map(t => ({ ...t, id: t._id }))
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

/* সার্ভারের ইংরেজি এরর → বাংলা */
function translateError(msg) {
    const map = {
        "exceeds daily limit": "আজকের সীমা পার হয়ে যাবে",
        "exceeds monthly limit": "এই মাসের সীমা পার হয়ে যাবে",
        "TrxID already exists": "এই আইডি আগেই লেখা আছে",
        "amount must be > 0": "টাকার পরিমাণ লিখুন",
        "type must be send or receive": "ধরন ঠিক নয়",
        "person not found": "মানুষ খুঁজে পাওয়া যায়নি",
        "invalid TrxID format": "আইডি ৮ থেকে ১২ অক্ষরের হতে হবে"
    };
    return map[msg] || msg;
}

/* ---------------- pending requests (লোকাল) ---------------- */
function getPending(personId) {
    return local.pending[personId] || [];
}
function addPending(personId, req) {
    local.pending[personId] = local.pending[personId] || [];
    local.pending[personId].push(req);
    saveLocal();
}
function removePending(personId, reqId) {
    local.pending[personId] = (local.pending[personId] || []).filter(r => r.id !== reqId);
    saveLocal();
}

/* ---------------- helpers ---------------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function toast(msg, kind) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast show" + (kind === "error" ? " error" : kind === "success" ? " success" : "");
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.className = "toast"; }, 2400);
}
function money(n) {
    const num = Number(n || 0);
    return "৳" + num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function initialsOf(n) {
    return (n || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
function dayKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function monthKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function normalizeWa(num) {
    let n = String(num || "").replace(/\D/g, "");
    if (n.startsWith("01") && n.length === 11) n = "88" + n;
    return n;
}

/* ---------------- ট্রানজেকশন আইডি যাচাই ---------------- */
function validateTrxId(trxId) {
    const clean = String(trxId || "").trim().toUpperCase();
    if (!clean) return { ok: false, reason: "খালি" };
    if (!/^[A-Z0-9]{8,12}$/.test(clean)) {
        return { ok: false, reason: "আইডি ৮ থেকে ১২ অক্ষরের হতে হবে" };
    }
    return { ok: true, clean };
}
function trxIdExists(personId, trxId, ignoreTxnId) {
    const clean = String(trxId || "").trim().toUpperCase();
    if (!clean) return false;
    const p = db.people.find(x => x.id === personId);
    if (p && (p.transactions || []).some(t =>
        t.id !== ignoreTxnId && (t.trxId || "").toUpperCase() === clean
    )) return true;
    return false;
}

/* ---------------- হিসাব ---------------- */
function summarize(p) {
    const pendingList = getPending(p.id);
    const pendingAmount = pendingList.reduce((s, r) => s + Number(r.amount || 0), 0);
    return {
        balance: Number(p.balance || 0),
        dailyUsed: Number(p.dailyUsed || 0),
        monthlyUsed: Number(p.monthlyUsed || 0),
        remDaily: Number(p.remDaily || 0),
        remMonthly: Number(p.remMonthly || 0),
        status: p.status || (
            Math.min(
                DAILY_LIMIT > 0 ? (p.remDaily || 0) / DAILY_LIMIT : 1,
                MONTHLY_LIMIT > 0 ? (p.remMonthly || 0) / MONTHLY_LIMIT : 1
            ) < 0.2 ? "red" : "yellow"
        ),
        pendingCount: pendingList.length,
        pendingAmount
    };
}

/* ---------------- পাতা বদল ---------------- */
function show(id) {
    ["viewDashboard", "viewAddPerson", "viewPerson"].forEach(v =>
        document.getElementById(v).classList.toggle("hidden", v !== id));
    window.scrollTo(0, 0);
}
async function showDashboard() {
    try { await refreshPeople(); }
    catch (e) { toast("সার্ভারে সংযোগ হয়নি", "error"); }
    renderDashboard();
    show("viewDashboard");
}
function showAddPerson() { resetPhotoPicker(); show("viewAddPerson"); }
async function showPerson(id) {
    try { await refreshPerson(id); }
    catch (e) { toast("লোড হয়নি: " + translateError(e.message), "error"); return; }
    renderPerson(id);
    show("viewPerson");
}

/* ---------------- হোয়াটসঅ্যাপ ---------------- */
function openWhatsApp(waNumber, message) {
    const num = normalizeWa(waNumber);
    const text = encodeURIComponent(message);
    const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent);
    const url = isMobile
        ? `whatsapp://send?phone=${num}&text=${text}`
        : `https://web.whatsapp.com/send?phone=${num}&text=${text}`;
    window.open(url, "_blank");
}

/* ---------------- লোগো (লোকাল) ---------------- */
const DEFAULT_LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff4a95"/>
      <stop offset="1" stop-color="#b30f58"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#g)"/>
  <text x="32" y="44" font-family="Arial,sans-serif" font-size="32"
        font-weight="700" fill="#fff" text-anchor="middle">৳</text>
</svg>`);
function renderLogo() {
    const img = document.getElementById("brandLogo");
    img.src = local.logo || DEFAULT_LOGO;
    img.onclick = changeLogo;
}
function changeLogo() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => {
                const size = 128;
                const c = document.createElement("canvas");
                c.width = size; c.height = size;
                const ctx = c.getContext("2d");
                const scale = Math.max(size / image.width, size / image.height);
                const w = image.width * scale, h = image.height * scale;
                ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
                local.logo = c.toDataURL("image/jpeg", 0.9);
                saveLocal(); renderLogo(); toast("লোগো বদলানো হয়েছে", "success");
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

/* ---------------- ছবি ---------------- */
let pendingPhotoDataUrl = null;
function resetPhotoPicker() {
    pendingPhotoDataUrl = null;
    const preview = document.getElementById("photoPreview");
    const fallback = document.getElementById("photoFallback");
    if (preview) { preview.src = ""; preview.classList.add("hidden"); }
    if (fallback) fallback.classList.remove("hidden");
    const fi = document.querySelector('input[name="photo"]');
    if (fi) fi.value = "";
}
function previewPhoto(e) {
    const file = e.target.files[0];
    if (!file) { resetPhotoPicker(); return; }
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const size = 200;
            const c = document.createElement("canvas");
            c.width = size; c.height = size;
            const ctx = c.getContext("2d");
            const scale = Math.max(size / img.width, size / img.height);
            const w = img.width * scale, h = img.height * scale;
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
    if (person.photo) return `<img class="avatar ${sizeClass}" src="${person.photo}" alt="${esc(person.name)}" />`;
    return `<div class="avatar ${sizeClass}">${initialsOf(person.name)}</div>`;
}

/* ---------------- মডাল ---------------- */
function showModal({ title, description = "", fields, submitLabel = "ঠিক আছে", cancelLabel = "বাতিল" }) {
    return new Promise(resolve => {
        const modalId = "m" + uid();
        const fieldsHtml = fields.map(f => `
      <div class="field">
        <label>${esc(f.label)}</label>
        <input id="${modalId}_${f.id}" type="${f.type || 'text'}"
               value="${f.value ?? ''}" placeholder="${esc(f.placeholder || '')}"
               inputmode="${f.inputmode || 'text'}" />
      </div>
    `).join("");
        const html = `
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
        document.getElementById("modalRoot").innerHTML = html;
        const bg = document.getElementById(`${modalId}_bg`);
        const cleanup = result => {
            document.getElementById("modalRoot").innerHTML = "";
            resolve(result);
        };
        bg.addEventListener("click", e => { if (e.target === bg) cleanup(null); });
        document.getElementById(`${modalId}_cancel`).onclick = () => cleanup(null);
        document.getElementById(`${modalId}_ok`).onclick = () => {
            const result = {};
            for (const f of fields) result[f.id] = document.getElementById(`${modalId}_${f.id}`).value;
            cleanup(result);
        };
        setTimeout(() => {
            if (fields[0]) document.getElementById(`${modalId}_${fields[0].id}`).focus();
        }, 60);
    });
}
function confirmModal({ title, description, submitLabel = "হ্যাঁ", cancelLabel = "না" }) {
    return new Promise(resolve => {
        const modalId = "m" + uid();
        const html = `
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
        document.getElementById("modalRoot").innerHTML = html;
        const bg = document.getElementById(`${modalId}_bg`);
        const cleanup = result => {
            document.getElementById("modalRoot").innerHTML = "";
            resolve(result);
        };
        bg.addEventListener("click", e => { if (e.target === bg) cleanup(false); });
        document.getElementById(`${modalId}_cancel`).onclick = () => cleanup(false);
        document.getElementById(`${modalId}_ok`).onclick = () => cleanup(true);
    });
}

/* ---------------- মূল পাতা ---------------- */
function renderDashboard() {
    const grid = document.getElementById("peopleGrid");
    if (db.people.length === 0) {
        grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <div class="icon">📋</div>
        <h3>এখনো কেউ যোগ করা হয়নি</h3>
        <p>হিসাব শুরু করতে নিচের বাটনে চাপ দিন।</p>
        <button class="btn btn-primary" style="margin-top:8px" onclick="showAddPerson()">
          ➕ প্রথম মানুষ যোগ করুন
        </button>
      </div>`;
        return;
    }
    grid.innerHTML = db.people.map((p, i) => {
        const s = summarize(p);
        const dailyPct = Math.max(0, Math.min(100, DAILY_LIMIT > 0 ? (s.remDaily / DAILY_LIMIT) * 100 : 0));
        const barColor = s.status === "red"
            ? "linear-gradient(90deg, #f87171, #dc2626)"
            : s.status === "yellow"
                ? "linear-gradient(90deg, #fbbf24, #f59e0b)"
                : "linear-gradient(90deg, #34d399, #0ea472)";
        const pendingBadge = s.pendingCount > 0
            ? `<span class="pending-badge">⏳ ${s.pendingCount} বাকি</span>` : "";
        return `
      <div class="card ${s.status}" onclick="showPerson('${p.id}')" style="animation-delay:${i * 40}ms">
        <div style="display:flex;align-items:center;gap:14px">
          ${avatarHTML(p, "avatar-sm")}
          <div style="flex:1;min-width:0">
            <h3>${esc(p.name)}${pendingBadge}</h3>
            <div class="num">${esc(p.bkashNumber)}</div>
          </div>
        </div>
        <div class="balance" style="margin-top:16px">${money(s.balance)}</div>
        <div class="limit-row"><span>আজ বাকি আছে</span><b>${money(s.remDaily)}</b></div>
        <div class="bar"><span style="width:${dailyPct}%;background:${barColor}"></span></div>
        <div class="limit-row" style="margin-top:12px"><span>এই মাসে বাকি আছে</span><b>${money(s.remMonthly)}</b></div>
      </div>`;
    }).join("");
}

/* ---------------- মানুষের বিবরণ ---------------- */
function renderPerson(id) {
    const p = db.people.find(x => x.id === id);
    if (!p) { showDashboard(); return; }
    const s = summarize(p);
    const txns = [...(p.transactions || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
    const pendings = getPending(p.id).slice().sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

    const warnings = [];
    if (s.remDaily < 0) warnings.push("আজকের সীমা শেষ হয়ে গেছে।");
    if (s.remMonthly < 0) warnings.push("এই মাসের সীমা শেষ হয়ে গেছে।");
    if (s.pendingCount > 0)
        warnings.push(`${s.pendingCount} টি টাকার উত্তরের অপেক্ষায় — মোট ${money(s.pendingAmount)}।`);

    const pendingBlock = pendings.length === 0 ? "" : `
    <div class="panel">
      <h2>📩 উত্তরের অপেক্ষায় (${pendings.length})</h2>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>কখন</th>
              <th class="right">টাকা</th>
              <th>কোথায়</th>
              <th>কে</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${pendings.map(r => `
              <tr>
                <td>${new Date(r.sentAt).toLocaleString("bn-BD")}</td>
                <td class="right">${money(r.amount)}</td>
                <td>${esc(r.destNumber)}</td>
                <td>${esc(r.waNumber)}</td>
                <td class="right" style="white-space:nowrap">
                  <button class="btn btn-wa btn-sm" onclick="markAsSent('${p.id}','${r.id}')">✔ পেয়েছি</button>
                  <button class="btn btn-light btn-sm" onclick="cancelPending('${p.id}','${r.id}')">✕</button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

    document.getElementById("personDetail").innerHTML = `
    <div class="panel">
      <div class="toolbar" style="align-items:flex-start">
        <div style="display:flex;align-items:center;gap:16px">
          ${avatarHTML(p, "avatar-lg")}
          <div>
            <h2 style="margin:0 0 4px;display:block">${esc(p.name)}</h2>
            <div style="color:var(--muted);font-size:15px">বিকাশ: ${esc(p.bkashNumber)}</div>
            ${p.whatsappNumber ? `<div style="color:var(--muted);font-size:14px">হোয়াটসঅ্যাপ: ${esc(p.whatsappNumber)}</div>` : ""}
          </div>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-wa btn-sm" onclick="openWaModal('${p.id}')">📱 টাকা চান</button>
        <button class="btn btn-light btn-sm" onclick="changePersonPhoto('${p.id}')">📷 ছবি</button>
        <button class="btn btn-light btn-sm" onclick="editUsed('${p.id}')">✏️ খরচ ঠিক</button>
        <button class="btn btn-danger btn-sm" onclick="deletePerson('${p.id}')">🗑 মুছুন</button>
      </div>

      ${warnings.length ? `<div class="warn" style="margin-top:20px"><span style="font-size:20px">⚠️</span><div>${warnings.join(" ")}</div></div>` : ""}

      <div class="stats" style="margin-top:20px">
        <div class="stat">
          <div class="lbl">এখনকার টাকা</div>
          <div class="val">${money(s.balance)}</div>
        </div>
        <div class="stat">
          <div class="lbl">আজ বাকি আছে</div>
          <div class="val">${money(s.remDaily)}</div>
          <div class="sub">খরচ ${money(s.dailyUsed)} / ${money(DAILY_LIMIT)}</div>
        </div>
        <div class="stat">
          <div class="lbl">এই মাসে বাকি আছে</div>
          <div class="val">${money(s.remMonthly)}</div>
          <div class="sub">খরচ ${money(s.monthlyUsed)} / ${money(MONTHLY_LIMIT)}</div>
        </div>
      </div>
    </div>

    ${pendingBlock}

    <div class="panel">
      <h2>➕ নতুন লেনদেন</h2>
      <form onsubmit="submitTransaction(event, '${p.id}')">
        <div class="row">
          <div class="field">
            <label>কী হয়েছে?</label>
            <select name="type" required>
              <option value="send">টাকা পাঠানো হয়েছে</option>
              <option value="receive">টাকা পাওয়া গেছে</option>
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
          <label>ট্রানজেকশন আইডি (না দিলেও চলবে)</label>
          <input name="trxId" placeholder="যেমন: 9F7A2B1C4D" />
        </div>
        <div class="field">
          <label>নোট (না দিলেও চলবে)</label>
          <input name="notes" placeholder="মনে রাখার মতো কিছু" />
        </div>
        <button class="btn btn-primary btn-block" type="submit">✔ যোগ করুন</button>
      </form>
    </div>

    <div class="panel">
      <h2>📜 সব লেনদেন (${txns.length})</h2>
      ${txns.length === 0
            ? `<div class="empty" style="padding:40px 20px"><div class="icon">📭</div><p>এখনো কোনো লেনদেন নেই।</p></div>`
            : `
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>তারিখ</th>
                <th>ধরন</th>
                <th class="right">টাকা</th>
                <th>আইডি</th>
                <th>কার সাথে</th>
                <th>নোট</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${txns.map(t => {
                const verified = !!(t.verified || (t.trxId && t.trxId.length > 0));
                const badge = t.type === "send"
                    ? (verified
                        ? `<span class="tag verified" style="font-size:11px;margin-left:6px">✔ ঠিক</span>`
                        : `<span class="tag pending" style="font-size:11px;margin-left:6px">⏳ আইডি নেই</span>`)
                    : "";
                return `
                  <tr>
                    <td>${new Date(t.date).toLocaleString("bn-BD")}</td>
                    <td><span class="tag ${t.type}">${t.type === "send" ? "পাঠানো" : "পাওয়া"}</span></td>
                    <td class="right">${money(t.amount)}</td>
                    <td>
                      ${t.trxId ? `<span class="trx-code">${esc(t.trxId)}</span>` : "—"}
                      ${badge}
                    </td>
                    <td>${esc(t.counterparty || "—")}</td>
                    <td>${esc(t.notes || "—")}</td>
                    <td class="right" style="white-space:nowrap">
                      ${t.type === "send" && !verified
                        ? `<button class="btn btn-light btn-sm" onclick="addTrxId('${p.id}','${t.id}')">➕ আইডি</button>`
                        : ""}
                      <button class="btn btn-light btn-sm" onclick="deleteTxn('${p.id}','${t.id}')">✕</button>
                    </td>
                  </tr>`;
            }).join("")}
            </tbody>
          </table>
        </div>`}
    </div>
  `;
}

function localNow() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

/* ---------------- টাকা চাওয়ার মডাল ---------------- */
function openWaModal(personId) {
    const p = db.people.find(x => x.id === personId);
    if (!p) return;
    const defaultDest = p.bkashNumber;
    const defaultWa = p.whatsappNumber ? normalizeWa(p.whatsappNumber) : "88" + p.bkashNumber;

    const html = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>📱 হোয়াটসঅ্যাপে টাকা চান</h3>
        <div class="modal-sub"><b>${esc(p.name)}</b> কে মেসেজ পাঠানো হবে</div>

        <div class="field">
          <label>কত টাকা চাইবেন?</label>
          <input id="waAmount" type="number" min="1" step="1" placeholder="5000" inputmode="numeric" />
        </div>
        <div class="field">
          <label>কোন বিকাশ নম্বরে পাঠাবে?</label>
          <input id="waDest" value="${esc(defaultDest)}" inputmode="numeric" />
        </div>
        <div class="field">
          <label>হোয়াটসঅ্যাপ নম্বর</label>
          <input id="waNumber" value="${esc(defaultWa)}" inputmode="numeric" />
        </div>

        <label style="margin-top:8px">যে মেসেজ যাবে</label>
        <div class="preview-msg" id="waPreview"></div>

        <div class="modal-actions">
          <button class="btn btn-light" onclick="closeModal()">বাতিল</button>
          <button class="btn btn-wa" onclick="sendWaMessage('${p.id}')">পাঠান</button>
        </div>
      </div>
    </div>`;
    document.getElementById("modalRoot").innerHTML = html;

    const update = () => {
        const amt = Number(document.getElementById("waAmount").value) || 0;
        const dest = document.getElementById("waDest").value || "";
        const msg =
            `আসসালামু আলাইকুম ${p.name},\n\n` +
            `অনুগ্রহ করে ${money(amt)} পাঠান বিকাশ নম্বর ${dest}-এ।\n\n` +
            `পাঠানোর পর এই ফরম্যাটে উত্তর দিন:\n` +
            `টাকা: \n` +
            `আইডি: \n\n` +
            `জাযাকাল্লাহ।`;
        document.getElementById("waPreview").textContent = msg;
    };
    ["waAmount", "waDest", "waNumber"].forEach(id => {
        document.getElementById(id).addEventListener("input", update);
    });
    update();
    setTimeout(() => document.getElementById("waAmount").focus(), 60);
}
function closeModal() { document.getElementById("modalRoot").innerHTML = ""; }

function sendWaMessage(personId) {
    const p = db.people.find(x => x.id === personId);
    if (!p) return;
    const amount = Number(document.getElementById("waAmount").value);
    const dest = document.getElementById("waDest").value.trim();
    const waNumber = normalizeWa(document.getElementById("waNumber").value);

    if (!amount || amount <= 0) { toast("টাকার পরিমাণ লিখুন", "error"); return; }
    if (!dest) { toast("বিকাশ নম্বর লিখুন", "error"); return; }
    if (!waNumber || waNumber.length < 11) { toast("হোয়াটসঅ্যাপ নম্বর ঠিক নয়", "error"); return; }

    const msg =
        `আসসালামু আলাইকুম ${p.name},\n\n` +
        `অনুগ্রহ করে ${money(amount)} পাঠান বিকাশ নম্বর ${dest}-এ।\n\n` +
        `পাঠানোর পর এই ফরম্যাটে উত্তর দিন:\n` +
        `টাকা: \n` +
        `আইডি: \n\n` +
        `জাযাকাল্লাহ।`;

    addPending(personId, {
        id: uid(), amount, destNumber: dest, waNumber,
        sentAt: new Date().toISOString(), status: "pending"
    });
    openWhatsApp(waNumber, msg);
    toast("হোয়াটসঅ্যাপ খোলা হয়েছে", "success");
    closeModal();
    renderPerson(personId);
}

async function markAsSent(personId, requestId) {
    const p = db.people.find(x => x.id === personId);
    if (!p) return;
    const req = getPending(personId).find(r => r.id === requestId);
    if (!req) return;

    const result = await showModal({
        title: "টাকা পেয়েছেন?",
        description: `৳${Number(req.amount).toLocaleString("en-IN")} টাকা পেয়েছেন কি?<br><br>` +
            `নিজের বিকাশ অ্যাপে বা এসএমএস-এ দেখে নিশ্চিত হয়ে তবেই হ্যাঁ চাপুন।`,
        fields: [{
            id: "trxId", label: "ট্রানজেকশন আইডি (না জানলে খালি রাখুন)",
            placeholder: "যেমন: 9F7A2B1C4D"
        }],
        submitLabel: "হ্যাঁ, পেয়েছি",
        cancelLabel: "এখন না"
    });
    if (!result) return;

    let trxId = null;
    const rawTrx = (result.trxId || "").trim();
    if (rawTrx) {
        const v = validateTrxId(rawTrx);
        if (!v.ok) { toast("আইডি ঠিক নয়: " + v.reason, "error"); return; }
        trxId = v.clean;
    }

    try {
        await api(`/api/people/${personId}/transactions`, {
            method: "POST",
            body: {
                type: "send",
                amount: Number(req.amount),
                date: new Date().toISOString(),
                counterparty: req.waNumber,
                trxId,
                notes: trxId ? "" : "হোয়াটসঅ্যাপে চাওয়া (আইডি এখনো নেই)"
            }
        });
        removePending(personId, requestId);
        await refreshPerson(personId);
        toast(trxId ? "যোগ হয়েছে ✔" : "যোগ হয়েছে (আইডি নেই)", "success");
        renderPerson(personId);
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

function cancelPending(personId, requestId) {
    confirmModal({
        title: "বাতিল করবেন?",
        description: "এই অনুরোধটি বাতিল হয়ে যাবে।",
        submitLabel: "হ্যাঁ, বাতিল"
    }).then(ok => {
        if (!ok) return;
        removePending(personId, requestId);
        toast("বাতিল হয়েছে");
        renderPerson(personId);
    });
}

async function addTrxId(personId, txnId) {
    const p = db.people.find(x => x.id === personId);
    if (!p) return;
    const t = (p.transactions || []).find(x => x.id === txnId);
    if (!t) return;

    const result = await showModal({
        title: "ট্রানজেকশন আইডি",
        description: t.trxId ? `এখন লেখা আছে: <b>${esc(t.trxId)}</b>` : "এই লেনদেনে আইডি দেওয়া হয়নি।",
        fields: [{
            id: "trxId", label: "সঠিক আইডি লিখুন (খালি রাখলে মুছে যাবে)",
            value: t.trxId || "", placeholder: "যেমন: 9F7A2B1C4D"
        }],
        submitLabel: "✔ সংরক্ষণ"
    });
    if (!result) return;

    const raw = (result.trxId || "").trim();
    let cleanTrx = null;
    if (raw) {
        const v = validateTrxId(raw);
        if (!v.ok) { toast("আইডি ঠিক নয়: " + v.reason, "error"); return; }
        cleanTrx = v.clean;
    }

    try {
        await api("/api/transactions/" + txnId, { method: "DELETE" });
        await api(`/api/people/${personId}/transactions`, {
            method: "POST",
            body: {
                type: t.type,
                amount: Number(t.amount),
                date: t.date,
                counterparty: t.counterparty || null,
                trxId: cleanTrx,
                notes: cleanTrx ? (t.notes || null) : "হোয়াটসঅ্যাপে চাওয়া (আইডি এখনো নেই)"
            }
        });
        await refreshPerson(personId);
        toast(cleanTrx ? "আইডি সংরক্ষণ হয়েছে ✔" : "আইডি মুছে ফেলা হয়েছে", "success");
        renderPerson(personId);
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

/* ---------------- মূল কাজগুলো ---------------- */
async function submitPerson(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = k => Number(f.get(k)) || 0;

    try {
        await api("/api/people", {
            method: "POST",
            body: {
                name: f.get("name").trim(),
                bkashNumber: f.get("bkashNumber").trim(),
                whatsappNumber: normalizeWa(f.get("whatsappNumber")) || null,
                photo: pendingPhotoDataUrl || null,
                initialBalance: num("initialBalance"),
                dailyUsedBase: num("dailyUsedBase"),
                monthlyUsedBase: num("monthlyUsedBase")
            }
        });
        e.target.reset();
        resetPhotoPicker();
        toast("যোগ হয়েছে ✔", "success");
        await showDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

async function submitTransaction(e, personId) {
    e.preventDefault();
    const f = new FormData(e.target);
    const type = f.get("type");
    const amount = Number(f.get("amount"));
    if (!amount || amount <= 0) { toast("টাকার পরিমাণ লিখুন", "error"); return; }

    const dateVal = f.get("date");
    const date = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();

    let trxId = null;
    const rawTrx = (f.get("trxId") || "").trim();
    if (rawTrx) {
        const v = validateTrxId(rawTrx);
        if (!v.ok) { toast("আইডি ঠিক নয়: " + v.reason, "error"); return; }
        trxId = v.clean;
    }

    try {
        await api(`/api/people/${personId}/transactions`, {
            method: "POST",
            body: {
                type,
                amount,
                date,
                counterparty: (f.get("counterparty") || "").trim() || null,
                trxId,
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

async function deleteTxn(personId, txnId) {
    const ok = await confirmModal({
        title: "মুছে ফেলবেন?",
        description: "এই লেনদেনটি চিরতরে মুছে যাবে।",
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
    const ok = await confirmModal({
        title: `${esc(p.name)} কে মুছবেন?`,
        description: "এই মানুষের সব লেনদেনও মুছে যাবে।",
        submitLabel: "হ্যাঁ, মুছুন"
    });
    if (!ok) return;
    try {
        await api("/api/people/" + id, { method: "DELETE" });
        delete local.pending[id];
        saveLocal();
        toast("মুছে ফেলা হয়েছে");
        await showDashboard();
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

async function editUsed(id) {
    const p = db.people.find(x => x.id === id);
    if (!p) return;

    const result = await showModal({
        title: "খরচ ঠিক করুন",
        description: "এখন পর্যন্ত কত টাকা পাঠানো হয়েছে সেটা লিখুন।",
        fields: [
            { id: "du", label: "আজ পাঠানো হয়েছে", type: "number", inputmode: "numeric", value: p.dailyUsedBase || 0 },
            { id: "mu", label: "এই মাসে পাঠানো হয়েছে", type: "number", inputmode: "numeric", value: p.monthlyUsedBase || 0 }
        ],
        submitLabel: "✔ সংরক্ষণ"
    });
    if (!result) return;
    const du = Number(result.du);
    const mu = Number(result.mu);
    if (isNaN(du) || du < 0 || isNaN(mu) || mu < 0) {
        toast("সঠিক সংখ্যা লিখুন", "error"); return;
    }

    try {
        await api("/api/people/" + id, {
            method: "PATCH",
            body: { dailyUsedBase: du, monthlyUsedBase: mu }
        });
        await refreshPerson(id);
        toast("সংরক্ষণ হয়েছে ✔", "success");
        renderPerson(id);
    } catch (err) {
        toast(translateError(err.message), "error");
    }
}

function changePersonPhoto(id) {
    const p = db.people.find(x => x.id === id);
    if (!p) return;
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = async () => {
                const size = 200;
                const c = document.createElement("canvas");
                c.width = size; c.height = size;
                const ctx = c.getContext("2d");
                const scale = Math.max(size / img.width, size / img.height);
                const w = img.width * scale, h = img.height * scale;
                ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                const dataUrl = c.toDataURL("image/jpeg", 0.85);
                try {
                    await api("/api/people/" + id, {
                        method: "PATCH",
                        body: { photo: dataUrl }
                    });
                    await refreshPerson(id);
                    toast("ছবি বদলানো হয়েছে ✔", "success");
                    renderPerson(id);
                } catch (err) {
                    toast(translateError(err.message), "error");
                }
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

/* ---------------- এক্সপোর্ট ---------------- */
async function exportCSV() {
    toast("তৈরি হচ্ছে...");
    const rows = [["নাম", "বিকাশ নম্বর", "ধরন", "টাকা", "তারিখ", "আইডি", "যাচাই", "কার সাথে", "নোট"]];

    try {
        for (const person of db.people) {
            const full = await api("/api/people/" + person.id);
            (full.transactions || []).forEach(t => {
                rows.push([
                    person.name, person.bkashNumber,
                    t.type === "send" ? "পাঠানো" : "পাওয়া",
                    t.amount, new Date(t.date).toLocaleString("bn-BD"),
                    t.trxId || "", t.verified ? "হ্যাঁ" : "না",
                    t.counterparty || "", t.notes || ""
                ]);
            });
        }
    } catch (err) {
        toast("এক্সপোর্ট ব্যর্থ", "error");
        return;
    }

    if (rows.length === 1) { toast("এক্সপোর্ট করার মতো কিছু নেই", "error"); return; }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `বিকাশ-হিসাব-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("ডাউনলোড হয়েছে ✔", "success");
}

/* ---------------- শুরু ---------------- */
loadLocal();
renderLogo();
showDashboard();