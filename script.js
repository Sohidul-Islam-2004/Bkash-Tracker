
      /* ------- FIXED LIMITS (change here if Bangladesh Bank changes them) ------- */
    const DAILY_LIMIT = 50000;
    const MONTHLY_LIMIT = 300000;

    /* ---------------- STORAGE ---------------- */
    const KEY = "bkash_tracker_v3";
    let db = {people: [], settings: {logo: null } };

    function load() {
        try {
          const raw = localStorage.getItem(KEY);
    if (raw) db = JSON.parse(raw);
        } catch (e) {
        console.warn("Load failed", e);
        }
    if (!db.people) db.people = [];
    if (!db.settings) db.settings = {logo: null };
      }
    function save() {
        localStorage.setItem(KEY, JSON.stringify(db));
      }
    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      }
    function toast(msg, isError) {
        const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast show" + (isError ? " error" : "");
    clearTimeout(t._t);
        t._t = setTimeout(() => {
        t.className = "toast";
        }, 2200);
      }
    function money(n) {
        return (
    "৳" +
    Number(n || 0).toLocaleString("en-US", {maximumFractionDigits: 2 })
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
    return (
        d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
    );
}

/* ---------------- CALCULATIONS ---------------- */
function summarize(p) {
    const now = new Date();
    const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const tKey = dayKey(now);
    const mKey = monthKey(now);
    const txns = (p.transactions || []).map((t) => ({
        ...t,
        date: new Date(t.date),
    }));
    const sum = (fn) => txns.filter(fn).reduce((s, t) => s + t.amount, 0);

    let dailyUsed = sum((t) => t.type === "send" && t.date >= startOfDay);
    let monthlyUsed = sum(
        (t) => t.type === "send" && t.date >= startOfMonth,
    );

    // Add "already used" baselines only if still in the same day/month
    if (p.baseDayKey === tKey) dailyUsed += Number(p.dailyUsedBase) || 0;
    if (p.baseMonthKey === mKey)
        monthlyUsed += Number(p.monthlyUsedBase) || 0;

    const balance = txns.reduce(
        (b, t) => {
            if (t.type === "receive") return b + t.amount;
            if (t.type === "send") return b - t.amount;
            return b;
        },
        Number(p.initialBalance) || 0,
    );

    const remDaily = DAILY_LIMIT - dailyUsed;
    const remMonthly = MONTHLY_LIMIT - monthlyUsed;

    const pctDaily = DAILY_LIMIT > 0 ? remDaily / DAILY_LIMIT : 1;
    const pctMonthly = MONTHLY_LIMIT > 0 ? remMonthly / MONTHLY_LIMIT : 1;
    const worst = Math.min(pctDaily, pctMonthly);

    let status = "green";
    if (worst < 0.2) status = "red";
    else if (worst < 0.5) status = "yellow";

    return {
        balance,
        dailyUsed,
        monthlyUsed,
        remDaily,
        remMonthly,
        status,
    };
}

/* ---------------- ROUTING ---------------- */
function show(id) {
    ["viewDashboard", "viewAddPerson", "viewPerson"].forEach((v) =>
        document.getElementById(v).classList.toggle("hidden", v !== id),
    );
    window.scrollTo(0, 0);
}
function showDashboard() {
    renderDashboard();
    show("viewDashboard");
}
function showAddPerson() {
    resetPhotoPicker();
    show("viewAddPerson");
}
function showPerson(id) {
    renderPerson(id);
    show("viewPerson");
}

/* ---------------- LOGO ---------------- */
const DEFAULT_LOGO =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#e2136e"/>
  <text x="32" y="42" font-family="Arial,sans-serif" font-size="28"
        font-weight="700" fill="#fff" text-anchor="middle">৳</text>
</svg>`,
    );
function renderLogo() {
    const img = document.getElementById("brandLogo");
    img.src = (db.settings && db.settings.logo) || DEFAULT_LOGO;
    img.onclick = changeLogo;
}
function changeLogo() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => {
                const size = 128;
                const c = document.createElement("canvas");
                c.width = size;
                c.height = size;
                const ctx = c.getContext("2d");
                const scale = Math.max(size / image.width, size / image.height);
                const w = image.width * scale,
                    h = image.height * scale;
                ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
                db.settings.logo = c.toDataURL("image/jpeg", 0.9);
                save();
                renderLogo();
                toast("Logo updated");
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

/* ---------------- PHOTO ---------------- */
let pendingPhotoDataUrl = null;
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
            const w = img.width * scale,
                h = img.height * scale;
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
    if (person.photo)
        return `<img class="avatar ${sizeClass}" src="${person.photo}" alt="${esc(person.name)}" />`;
    return `<div class="avatar ${sizeClass}">${initialsOf(person.name)}</div>`;
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard() {
    const grid = document.getElementById("peopleGrid");
    if (db.people.length === 0) {
        grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1;">
        <h3>No people added yet</h3>
        <p>Add a person to start tracking their balance and limits.</p>
        <button class="btn btn-primary" style="margin-top:12px;" onclick="showAddPerson()">+ Add your first person</button>
      </div>`;
        return;
    }
    grid.innerHTML = db.people
        .map((p) => {
            const s = summarize(p);
            const dailyPct = Math.max(
                0,
                Math.min(
                    100,
                    DAILY_LIMIT > 0 ? (s.remDaily / DAILY_LIMIT) * 100 : 0,
                ),
            );
            const barColor =
                s.status === "red"
                    ? "var(--red)"
                    : s.status === "yellow"
                        ? "var(--yellow)"
                        : "var(--green)";
            return `
      <div class="card ${s.status}" onclick="showPerson('${p.id}')">
        <div style="display:flex;align-items:center;gap:12px;">
          ${avatarHTML(p, "avatar-sm")}
          <div>
            <h3>${esc(p.name)}</h3>
            <div class="num">${esc(p.bKashNumber)}</div>
          </div>
        </div>
        <div class="balance" style="margin-top:12px;">${money(s.balance)}</div>
        <div class="limit-row"><span>Daily left</span><b>${money(s.remDaily)}</b></div>
        <div class="bar"><span style="width:${dailyPct}%;background:${barColor};"></span></div>
        <div class="limit-row" style="margin-top:10px;"><span>Monthly left</span><b>${money(s.remMonthly)}</b></div>
      </div>`;
        })
        .join("");
}

/* ---------------- PERSON DETAIL ---------------- */
function renderPerson(id) {
    const p = db.people.find((x) => x.id === id);
    if (!p) {
        showDashboard();
        return;
    }
    const s = summarize(p);
    const txns = [...(p.transactions || [])].sort(
        (a, b) => new Date(b.date) - new Date(a.date),
    );

    const warnings = [];
    if (s.remDaily < 0) warnings.push("Daily limit exceeded.");
    if (s.remMonthly < 0) warnings.push("Monthly limit exceeded.");

    document.getElementById("personDetail").innerHTML = `
    <div class="panel">
      <div class="toolbar" style="align-items:flex-start;">
        <div style="display:flex;align-items:center;gap:14px;">
          ${avatarHTML(p, "avatar-lg")}
          <div>
            <h2 style="margin:0 0 4px;">${esc(p.name)}</h2>
            <div style="color:var(--muted);font-size:13px;">${esc(p.bKashNumber)}</div>
          </div>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-light btn-sm" onclick="changePersonPhoto('${p.id}')">Change Photo</button>
        <button class="btn btn-light btn-sm" onclick="editUsed('${p.id}')">Edit Used</button>
        <button class="btn btn-danger btn-sm" onclick="deletePerson('${p.id}')">Delete</button>
      </div>

      ${warnings.length ? `<div class="warn" style="margin-top:14px;">⚠️ ${warnings.join(" ")}</div>` : ""}

      <div class="stats" style="margin-top:16px;">
        <div class="stat">
          <div class="lbl">Balance</div>
          <div class="val">${money(s.balance)}</div>
        </div>
        <div class="stat">
          <div class="lbl">Daily Limit Left</div>
          <div class="val">${money(s.remDaily)}</div>
          <div class="sub">Used ${money(s.dailyUsed)} of ${money(DAILY_LIMIT)}</div>
        </div>
        <div class="stat">
          <div class="lbl">Monthly Limit Left</div>
          <div class="val">${money(s.remMonthly)}</div>
          <div class="sub">Used ${money(s.monthlyUsed)} of ${money(MONTHLY_LIMIT)}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>Add Transaction</h2>
      <form onsubmit="submitTransaction(event, '${p.id}')">
        <div class="row">
          <div class="field">
            <label>Type</label>
            <select name="type" required>
              <option value="send">Send</option>
              <option value="receive">Receive</option>
            </select>
          </div>
          <div class="field">
            <label>Amount (৳)</label>
            <input name="amount" type="number" min="1" step="0.01" required placeholder="0" />
          </div>
          <div class="field">
            <label>Counterparty (optional)</label>
            <input name="counterparty" placeholder="Name or number" />
          </div>
          <div class="field">
            <label>Date &amp; Time</label>
            <input name="date" type="datetime-local" value="${localNow()}" />
          </div>
        </div>
        <div class="field">
          <label>Notes (optional)</label>
          <input name="notes" placeholder="Anything to remember" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;">Add Transaction</button>
      </form>
    </div>

    <div class="panel">
      <h2>History (${txns.length})</h2>
      ${txns.length === 0
            ? `<p style="color:var(--muted);font-size:14px;">No transactions yet.</p>`
            : `
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Type</th><th class="right">Amount</th>
              <th>Counterparty</th><th>Notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${txns
                .map(
                    (t) => `
              <tr>
                <td>${new Date(t.date).toLocaleString()}</td>
                <td><span class="tag ${t.type}">${t.type}</span></td>
                <td class="right">${money(t.amount)}</td>
                <td>${esc(t.counterparty || "—")}</td>
                <td>${esc(t.notes || "—")}</td>
                <td class="right">
                  <button class="btn btn-light btn-sm" onclick="deleteTxn('${p.id}','${t.id}')">✕</button>
                </td>
              </tr>`,
                )
                .join("")}
          </tbody>
        </table>
      </div>`
        }
    </div>
  `;
}

function localNow() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

/* ---------------- ACTIONS ---------------- */
function submitPerson(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = (k) => Number(f.get(k)) || 0;
    const now = new Date();

    const person = {
        id: uid(),
        name: f.get("name").trim(),
        bKashNumber: f.get("bKashNumber").trim(),
        photo: pendingPhotoDataUrl || null,
        initialBalance: num("initialBalance"),
        dailyUsedBase: num("dailyUsedBase"),
        monthlyUsedBase: num("monthlyUsedBase"),
        baseDayKey: dayKey(now),
        baseMonthKey: monthKey(now),
        transactions: [],
        createdAt: now.toISOString(),
    };

    db.people.unshift(person);
    save();
    e.target.reset();
    resetPhotoPicker();
    toast("Person added");
    showDashboard();
}

function submitTransaction(e, personId) {
    e.preventDefault();
    const p = db.people.find((x) => x.id === personId);
    if (!p) return;
    const f = new FormData(e.target);
    const type = f.get("type");
    const amount = Number(f.get("amount"));
    if (!amount || amount <= 0) {
        toast("Enter a valid amount", true);
        return;
    }

    const dateVal = f.get("date");
    const date = dateVal
        ? new Date(dateVal).toISOString()
        : new Date().toISOString();

    if (type === "send") {
        const before = summarize(p);
        if (amount > before.remDaily) {
            toast("Exceeds daily limit", true);
            return;
        }
        if (amount > before.remMonthly) {
            toast("Exceeds monthly limit", true);
            return;
        }
    }

    p.transactions.push({
        id: uid(),
        type,
        amount,
        date,
        counterparty: (f.get("counterparty") || "").trim(),
        notes: (f.get("notes") || "").trim(),
    });
    save();
    toast("Transaction added");
    renderPerson(personId);
}

function deleteTxn(personId, txnId) {
    if (!confirm("Delete this transaction?")) return;
    const p = db.people.find((x) => x.id === personId);
    p.transactions = p.transactions.filter((t) => t.id !== txnId);
    save();
    toast("Transaction deleted");
    renderPerson(personId);
}

function deletePerson(id) {
    const p = db.people.find((x) => x.id === id);
    if (!confirm(`Delete ${p.name} and all their transactions?`)) return;
    db.people = db.people.filter((x) => x.id !== id);
    save();
    toast("Person deleted");
    showDashboard();
}

function editUsed(id) {
    const p = db.people.find((x) => x.id === id);
    if (!p) return;
    const now = new Date();

    const ask = (label, current) => {
        const v = prompt(label, current);
        if (v === null) return null;
        const n = Number(v);
        return isNaN(n) || n < 0 ? null : n;
    };

    const du = ask("Already used TODAY (৳)", p.dailyUsedBase || 0);
    if (du === null) return;
    const mu = ask("Already used THIS MONTH (৳)", p.monthlyUsedBase || 0);
    if (mu === null) return;

    p.dailyUsedBase = du;
    p.monthlyUsedBase = mu;
    p.baseDayKey = dayKey(now);
    p.baseMonthKey = monthKey(now);
    save();
    toast("Used amounts updated");
    renderPerson(id);
}

function changePersonPhoto(id) {
    const p = db.people.find((x) => x.id === id);
    if (!p) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
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
                const w = img.width * scale,
                    h = img.height * scale;
                ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                p.photo = c.toDataURL("image/jpeg", 0.85);
                save();
                toast("Photo updated");
                renderPerson(id);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

/* ---------------- CSV ---------------- */
function exportCSV() {
    const rows = [
        [
            "Person",
            "bKash Number",
            "Type",
            "Amount",
            "Date",
            "Counterparty",
            "Notes",
        ],
    ];
    db.people.forEach((p) => {
        (p.transactions || []).forEach((t) => {
            rows.push([
                p.name,
                p.bKashNumber,
                t.type,
                t.amount,
                new Date(t.date).toLocaleString(),
                t.counterparty || "",
                t.notes || "",
            ]);
        });
    });
    if (rows.length === 1) {
        toast("Nothing to export", true);
        return;
    }
    const csv = rows
        .map((r) =>
            r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
        )
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bkash-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV downloaded");
}

/* ---------------- INIT ---------------- */
load();
renderLogo();
showDashboard();
    