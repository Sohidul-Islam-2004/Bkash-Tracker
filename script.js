/* ======================================================
   নির্দিষ্ট সীমা
   ====================================================== */
const DAILY_LIMIT = 50000;
const MONTHLY_LIMIT = 300000;

/* ---------------- সংরক্ষণ ---------------- */
const KEY = "bkash_tracker_bn_v2";
let db = { people: [], settings: { logo: null } };

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) db = JSON.parse(raw);
        else {
            // migrate from v1 if present
            const old = localStorage.getItem("bkash_tracker_bn_v1");
            if (old) db = JSON.parse(old);
        }
    } catch (e) { console.warn("লোড হয়নি", e); }
    if (!db.people) db.people = [];
    if (!db.settings) db.settings = { logo: null };
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
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
        t.id !== ignoreTxnId &&
        ((t.trxId || "").toUpperCase() === clean || (t.notes || "").toUpperCase().includes(clean))
    )) return true;
    return db.people.some(pp => (pp.transactions || []).some(t =>
        t.id !== ignoreTxnId &&
        ((t.trxId || "").toUpperCase() === clean || (t.notes || "").toUpperCase().includes(clean))
    ));
}

/* ---------------- হিসাব ---------------- */
function summarize(p) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const tKey = dayKey(now);
    const mKey = monthKey(now);
    const txns = (p.transactions || []).map(t => ({ ...t, date: new Date(t.date) }));
    const sum = fn => txns.filter(fn).reduce((s, t) => s + t.amount, 0);

    let dailyUsed = sum(t => t.type === "send" && t.date >= startOfDay);
    let monthlyUsed = sum(t => t.type === "send" && t.date >= startOfMonth);
    if (p.baseDayKey === tKey) dailyUsed += Number(p.dailyUsedBase) || 0;
    if (p.baseMonthKey === mKey) monthlyUsed += Number(p.monthlyUsedBase) || 0;

    const balance = txns.reduce((b, t) => {
        if (t.type === "receive") return b + t.amount;
        if (t.type === "send") return b - t.amount;
        return b;
    }, Number(p.initialBalance) || 0);

    const remDaily = DAILY_LIMIT - dailyUsed;
    const remMonthly = MONTHLY_LIMIT - monthlyUsed;
    const pctDaily = DAILY_LIMIT > 0 ? remDaily / DAILY_LIMIT : 1;
    const pctMonthly = MONTHLY_LIMIT > 0 ? remMonthly / MONTHLY_LIMIT : 1;
    const worst = Math.min(pctDaily, pctMonthly);

    let status = "green";
    if (worst < 0.2) status = "red";
    else if (worst < 0.5) status = "yellow";

    const pending = (p.pendingRequests || []).filter(r => r.status === "pending");
    const pendingAmount = pending.reduce((s, r) => s + Number(r.amount || 0), 0);

    return {
        balance, dailyUsed, monthlyUsed, remDaily, remMonthly, status,
        pendingCount: pending.length, pendingAmount
    };
}

/* ---------------- পাতা বদল ---------------- */
function show(id) {
    ["viewDashboard", "viewAddPerson", "viewPerson"].forEach(v =>
        document.getElementById(v).classList.toggle("hidden", v !== id));
    window.scrollTo(0, 0);
}
function showDashboard() { renderDashboard(); show("viewDashboard"); }
function showAddPerson() { resetPhotoPicker(); show("viewAddPerson"); }
function showPerson(id) { renderPerson(id); show("viewPerson"); }

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

/* ---------------- লোগো ---------------- */
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
    img.src = (db.settings && db.settings.logo) || DEFAULT_LOGO;
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
                db.settings.logo = c.toDataURL("image/jpeg", 0.9);
                save(); renderLogo(); toast("লোগো বদলানো হয়েছে", "success");
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
            <div class="num">${esc(p.bKashNumber)}</div>
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
    const pendings = (p.pendingRequests || []).filter(r => r.status === "pending")
        .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

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
            <div style="color:var(--muted);font-size:15px">বিকাশ: ${esc(p.bKashNumber)}</div>
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
    const defaultDest = p.bKashNumber;
    const defaultWa = p.whatsappNumber ? normalizeWa(p.whatsappNumber) : "88" + p.bKashNumber;

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

    p.pendingRequests = p.pendingRequests || [];
    p.pendingRequests.push({
        id: uid(), amount, destNumber: dest, waNumber,
        sentAt: new Date().toISOString(), status: "pending"
    });
    if (!p.whatsappNumber) p.whatsappNumber = waNumber;
    save();
    openWhatsApp(waNumber, msg);
    toast("হোয়াটসঅ্যাপ খোলা হয়েছে", "success");
    closeModal();
    renderPerson(personId);
}

async function markAsSent(personId, requestId) {
    const p = db.people.find(x => x.id === personId);
    if (!p) return;
    const req = (p.pendingRequests || []).find(r => r.id === requestId);
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

    let trxId = "";
    const rawTrx = (result.trxId || "").trim();
    if (rawTrx) {
        const v = validateTrxId(rawTrx);
        if (!v.ok) { toast("আইডি ঠিক নয়: " + v.reason, "error"); return; }
        if (trxIdExists(personId, v.clean)) {
            const still = await confirmModal({
                title: "⚠️ এই আইডি আগে ব্যবহার হয়েছে",
                description: `আইডি <b>${v.clean}</b> আগেই লেখা আছে। তবুও যোগ করবেন?`,
                submitLabel: "হ্যাঁ, যোগ করুন"
            });
            if (!still) return;
        }
        trxId = v.clean;
    }

    const before = summarize(p);
    if (req.amount > before.remDaily) { toast("আজকের সীমা পার হয়ে যাবে", "error"); return; }
    if (req.amount > before.remMonthly) { toast("এই মাসের সীমা পার হয়ে যাবে", "error"); return; }

    p.transactions.push({
        id: uid(),
        type: "send",
        amount: Number(req.amount),
        date: new Date().toISOString(),
        counterparty: req.waNumber,
        trxId: trxId || null,
        verified: !!trxId,
        notes: trxId ? "" : "হোয়াটসঅ্যাপে চাওয়া (আইডি এখনো নেই)"
    });
    req.status = "sent";
    req.completedAt = new Date().toISOString();
    req.trxId = trxId || null;
    save();
    toast(trxId ? "যোগ হয়েছে ✔" : "যোগ হয়েছে (আইডি নেই)", "success");
    renderPerson(personId);
}

async function cancelPending(personId, requestId) {
    const ok = await confirmModal({
        title: "বাতিল করবেন?",
        description: "এই অনুরোধটি বাতিল হয়ে যাবে।",
        submitLabel: "হ্যাঁ, বাতিল"
    });
    if (!ok) return;
    const p = db.people.find(x => x.id === personId);
    if (!p) return;
    p.pendingRequests = (p.pendingRequests || []).filter(r => r.id !== requestId);
    save();
    toast("বাতিল হয়েছে");
    renderPerson(personId);
}

async function addTrxId(personId, txnId) {
    const p = db.people.find(x => x.id === personId);
    if (!p) return;
    const t = p.transactions.find(x => x.id === txnId);
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
    if (!raw) {
        t.trxId = null; t.verified = false;
        t.notes = "হোয়াটসঅ্যাপে চাওয়া (আইডি এখনো নেই)";
        save(); toast("আইডি মুছে ফেলা হয়েছে");
        renderPerson(personId);
        return;
    }
    const v = validateTrxId(raw);
    if (!v.ok) { toast("আইডি ঠিক নয়: " + v.reason, "error"); return; }
    if (trxIdExists(personId, v.clean, txnId)) {
        const ok = await confirmModal({
            title: "⚠️ এই আইডি আগে আছে",
            description: `আইডি <b>${v.clean}</b> আগেই লেখা আছে। তবুও সংরক্ষণ করবেন?`,
            submitLabel: "হ্যাঁ"
        });
        if (!ok) return;
    }
    t.trxId = v.clean; t.verified = true;
    if (!t.notes || t.notes.startsWith("হোয়াটসঅ্যাপ")) t.notes = "";
    save(); toast("আইডি সংরক্ষণ হয়েছে ✔", "success");
    renderPerson(personId);
}

/* ---------------- মূল কাজগুলো ---------------- */
function submitPerson(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = k => Number(f.get(k)) || 0;
    const now = new Date();

    const person = {
        id: uid(),
        name: f.get("name").trim(),
        bKashNumber: f.get("bKashNumber").trim(),
        whatsappNumber: normalizeWa(f.get("whatsappNumber")) || "",
        photo: pendingPhotoDataUrl || null,
        initialBalance: num("initialBalance"),
        dailyUsedBase: num("dailyUsedBase"),
        monthlyUsedBase: num("monthlyUsedBase"),
        baseDayKey: dayKey(now),
        baseMonthKey: monthKey(now),
        transactions: [],
        pendingRequests: [],
        createdAt: now.toISOString()
    };
    db.people.unshift(person);
    save();
    e.target.reset();
    resetPhotoPicker();
    toast("যোগ হয়েছে ✔", "success");
    showDashboard();
}

function submitTransaction(e, personId) {
    e.preventDefault();
    const p = db.people.find(x => x.id === personId);
    if (!p) return;
    const f = new FormData(e.target);
    const type = f.get("type");
    const amount = Number(f.get("amount"));
    if (!amount || amount <= 0) { toast("টাকার পরিমাণ লিখুন", "error"); return; }

    const dateVal = f.get("date");
    const date = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();

    let trxId = "";
    const rawTrx = (f.get("trxId") || "").trim();
    if (rawTrx) {
        const v = validateTrxId(rawTrx);
        if (!v.ok) { toast("আইডি ঠিক নয়: " + v.reason, "error"); return; }
        if (trxIdExists(personId, v.clean)) {
            if (!confirm(`আইডি ${v.clean} আগেই লেখা আছে। তবুও যোগ করবেন?`)) return;
        }
        trxId = v.clean;
    }

    if (type === "send") {
        const before = summarize(p);
        if (amount > before.remDaily) { toast("আজকের সীমা পার হয়ে যাবে", "error"); return; }
        if (amount > before.remMonthly) { toast("এই মাসের সীমা পার হয়ে যাবে", "error"); return; }
    }

    p.transactions.push({
        id: uid(), type, amount, date,
        counterparty: (f.get("counterparty") || "").trim(),
        trxId: trxId || null,
        verified: !!trxId,
        notes: (f.get("notes") || "").trim()
    });
    save();
    toast("যোগ হয়েছে ✔", "success");
    renderPerson(personId);
}

async function deleteTxn(personId, txnId) {
    const ok = await confirmModal({
        title: "মুছে ফেলবেন?",
        description: "এই লেনদেনটি চিরতরে মুছে যাবে।",
        submitLabel: "হ্যাঁ, মুছুন"
    });
    if (!ok) return;
    const p = db.people.find(x => x.id === personId);
    p.transactions = p.transactions.filter(t => t.id !== txnId);
    save(); toast("মুছে ফেলা হয়েছে");
    renderPerson(personId);
}

async function deletePerson(id) {
    const p = db.people.find(x => x.id === id);
    const ok = await confirmModal({
        title: `${esc(p.name)} কে মুছবেন?`,
        description: "এই মানুষের সব লেনদেনও মুছে যাবে।",
        submitLabel: "হ্যাঁ, মুছুন"
    });
    if (!ok) return;
    db.people = db.people.filter(x => x.id !== id);
    save(); toast("মুছে ফেলা হয়েছে");
    showDashboard();
}

async function editUsed(id) {
    const p = db.people.find(x => x.id === id);
    if (!p) return;
    const now = new Date();

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
    p.dailyUsedBase = du;
    p.monthlyUsedBase = mu;
    p.baseDayKey = dayKey(now);
    p.baseMonthKey = monthKey(now);
    save(); toast("সংরক্ষণ হয়েছে ✔", "success");
    renderPerson(id);
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
            img.onload = () => {
                const size = 200;
                const c = document.createElement("canvas");
                c.width = size; c.height = size;
                const ctx = c.getContext("2d");
                const scale = Math.max(size / img.width, size / img.height);
                const w = img.width * scale, h = img.height * scale;
                ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                p.photo = c.toDataURL("image/jpeg", 0.85);
                save(); toast("ছবি বদলানো হয়েছে ✔", "success");
                renderPerson(id);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

/* ---------------- এক্সপোর্ট ---------------- */
function exportCSV() {
    const rows = [["নাম", "বিকাশ নম্বর", "ধরন", "টাকা", "তারিখ", "আইডি", "যাচাই", "কার সাথে", "নোট"]];
    db.people.forEach(p => {
        (p.transactions || []).forEach(t => {
            rows.push([
                p.name, p.bKashNumber,
                t.type === "send" ? "পাঠানো" : "পাওয়া",
                t.amount, new Date(t.date).toLocaleString("bn-BD"),
                t.trxId || "", t.verified ? "হ্যাঁ" : "না",
                t.counterparty || "", t.notes || ""
            ]);
        });
    });
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
load();
renderLogo();
showDashboard();