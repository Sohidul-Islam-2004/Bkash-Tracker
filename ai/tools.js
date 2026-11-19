/* ============================================================
   AI TOOLS
   - "read" tool gulo shathe shathe chole (hisab dekha)
   - "write" tool gulo shudhu PROSTUTI kore; user Confirm chaple tobe save hoy
   - Save hoy tomar ager API route diye, tai limit/balance check shob ager motoi
   ============================================================ */
const crypto = require("crypto");
const mongoose = require("mongoose");

const M = (name) => mongoose.model(name);
const API = () => `http://127.0.0.1:${process.env.PORT || 3000}`;

const DAILY_LIMIT = 50000;
const MONTHLY_LIMIT = 300000;

const BN = "০১২৩৪৫৬৭৮৯";
const toEn = (s) => String(s ?? "").replace(/[০-৯]/g, (d) => BN.indexOf(d));
const money = (n) => "৳" + Number(n || 0).toLocaleString("en-IN");

function dayKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const monthKey = (d = new Date()) => dayKey(d).slice(0, 7);

function cleanPhone(n) {
    const s = toEn(n).replace(/[\s\-+]/g, "").replace(/^88/, "");
    return /^01[3-9]\d{8}$/.test(s) ? s : null;
}
function cleanAmount(a) {
    const n = Number(toEn(a).replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
}
function cleanDate(d) {
    if (!d) return dayKey();
    const s = toEn(d).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function api(path, options = {}) {
    const res = await fetch(API() + path, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    if (!res.ok) throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
    return data;
}

/* ---------- nam diye khuje ber kora ---------- */
function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

function findByName(list, name, extra = () => false) {
    const q = norm(name);
    if (!q) return { error: "Nam deya hoy nai" };
    let hits = list.filter((x) => norm(x.name) === q || extra(x, q));
    if (!hits.length) hits = list.filter((x) => norm(x.name).includes(q) || q.includes(norm(x.name)));
    if (hits.length === 1) return { item: hits[0] };
    const names = list.map((x) => x.name).join(", ") || "(keu nai)";
    if (!hits.length) return { error: `"${name}" nam e keu nai. Ache: ${names}` };
    return { error: `"${name}" nam e ${hits.length} jon: ${hits.map((h) => h.name).join(", ")}. Kon jon?` };
}

const bkashPeople = () => M("Person").find({}, "name bkashNumber initialBalance dailyUsedBase monthlyUsedBase baseDayKey baseMonthKey bundleCount").lean();
const findBkash = async (name) =>
    findByName(await bkashPeople(), name, (p, q) => cleanPhone(q) && p.bkashNumber === cleanPhone(q));

/* ============================================================
   NAM-ER LIST (system prompt e jay, jate AI thik nam use kore)
   ============================================================ */
async function namesForPrompt() {
    const [people, pawna, banks, gila] = await Promise.all([
        M("Person").find({}, "name bkashNumber").lean(),
        M("Pawna").find({}, "name").lean(),
        M("Bank").find({}, "name").lean(),
        M("Gila").find({}, "name").lean(),
    ]);
    return [
        `bKash account: ${people.map((p) => `${p.name} (${p.bkashNumber})`).join(", ") || "nai"}`,
        `Pawna manush: ${pawna.map((p) => p.name).join(", ") || "nai"}`,
        `Bank: ${banks.map((b) => b.name).join(", ") || "nai"}`,
        `Gila manush: ${gila.map((g) => g.name).join(", ") || "nai"}`,
    ].join("\n");
}

/* ============================================================
   READ TOOLS
   ============================================================ */
async function getOverview() {
    const tKey = dayKey(), mKey = monthKey();
    const [people, banks, cash, pawna, gila, entries] = await Promise.all([
        bkashPeople(),
        M("Bank").find({}, "name totalDeposit totalWithdraw transactions.type transactions.amount").lean(),
        M("Cash").findOne({}, "balance").lean(),
        M("Pawna").find({}, "name totalSend totalReceive").lean(),
        M("Gila").find({}, "name advance price entries").lean(),
        M("Entries").find({ date: tKey }, "total count deposit").lean(),
    ]);
    return {
        today: tKey,
        bkash: people.map((p) => {
            const daily = p.baseDayKey === tKey ? p.dailyUsedBase || 0 : 0;
            const monthly = p.baseMonthKey === mKey ? p.monthlyUsedBase || 0 : 0;
            return {
                name: p.name, number: p.bkashNumber, balance: p.initialBalance || 0,
                dailyRemaining: DAILY_LIMIT - daily, monthlyRemaining: MONTHLY_LIMIT - monthly,
                bundleLeft: p.bundleCount || 0,
            };
        }),
        banks: banks.map((b) => {
            let d = b.totalDeposit, w = b.totalWithdraw;
            if (typeof d !== "number" || typeof w !== "number") {
                d = 0; w = 0;
                (b.transactions || []).forEach((t) => (t.type === "withdraw" ? (w += t.amount) : (d += t.amount)));
            }
            return { name: b.name, balance: d - w };
        }),
        cashBalance: cash ? cash.balance || 0 : 0,
        pawna: pawna.map((p) => {
            const net = (p.totalSend || 0) - (p.totalReceive || 0);
            return { name: p.name, net, meaning: net > 0 ? "se amake debe (ami pabo)" : net < 0 ? "ami take dibo" : "soman" };
        }),
        gila: gila.map((g) => ({
            name: g.name, advance: g.advance, pricePerPiece: g.price,
            totalPieces: (g.entries || []).reduce((s, e) => s + (e.pieces || 0), 0),
        })),
        entriesToday: {
            total: entries.reduce((s, e) => s + (e.total || 0), 0),
            count: entries.reduce((s, e) => s + (e.count || 0), 0),
            deposit: entries.reduce((s, e) => s + (e.deposit || 0), 0),
        },
    };
}

async function getEntries({ date }) {
    const d = cleanDate(date);
    if (!d) return { error: "Tarikh YYYY-MM-DD format e dao" };
    const recs = await M("Entries").find({ date: d }).lean();
    return {
        date: d,
        records: recs.length,
        total: recs.reduce((s, r) => s + (r.total || 0), 0),
        count: recs.reduce((s, r) => s + (r.count || 0), 0),
        deposit: recs.reduce((s, r) => s + (r.deposit || 0), 0),
        entries: recs.flatMap((r) => r.entries).slice(0, 60),
    };
}

async function getHistory({ module, name, limit }) {
    const n = Math.min(Number(limit) || 10, 30);
    if (module === "bkash") {
        const f = await findBkash(name);
        if (f.error) return f;
        const tx = await M("Transaction").find({ person: f.item._id }).sort({ date: -1 }).limit(n).lean();
        return { name: f.item.name, transactions: tx.map((t) => ({ type: t.type, amount: t.amount, date: t.date, counterparty: t.counterparty, trxId: t.trxId, notes: t.notes })) };
    }
    if (module === "pawna") {
        const f = findByName(await M("Pawna").find().lean(), name);
        if (f.error) return f;
        const tx = (f.item.transactions || []).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, n);
        return { name: f.item.name, transactions: tx.map((t) => ({ type: t.type, amount: t.amount, date: t.date, notes: t.notes })) };
    }
    if (module === "bank") {
        const f = findByName(await M("Bank").find().lean(), name);
        if (f.error) return f;
        const tx = (f.item.transactions || []).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, n);
        return { name: f.item.name, transactions: tx.map((t) => ({ type: t.type, amount: t.amount, date: t.date, name: t.name, notes: t.notes })) };
    }
    if (module === "cash") {
        const c = await M("Cash").findOne().lean();
        const tx = ((c && c.transactions) || []).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, n);
        return { balance: c ? c.balance : 0, transactions: tx.map((t) => ({ type: t.type, amount: t.amount, date: t.date, name: t.name })) };
    }
    if (module === "gila") {
        const f = findByName(await M("Gila").find().lean(), name);
        if (f.error) return f;
        return { name: f.item.name, advance: f.item.advance, price: f.item.price, entries: (f.item.entries || []).slice(-n) };
    }
    return { error: "module hobe: bkash, pawna, bank, cash, gila" };
}

/* ============================================================
   WRITE TOOLS — prepare() check kore + summary banay,
   run() asholei save kore (Confirm er por)
   ============================================================ */
const WRITERS = {
    async bkash_transaction(a) {
        const f = await findBkash(a.person);
        if (f.error) return f;
        const amount = cleanAmount(a.amount);
        if (!amount) return { error: "Amount thik nai" };
        if (!["send", "receive"].includes(a.type)) return { error: "type hobe send ba receive" };
        const p = f.item;
        const trxId = a.trxId ? String(a.trxId).toUpperCase().trim() : null;
        const label = a.type === "send" ? "পাঠানো (Send)" : "আসা (Receive)";
        return {
            summary: `বিকাশ • ${p.name} (${p.bkashNumber}) • ${label} • ${money(amount)}`
                + (a.counterparty ? ` • ${a.counterparty}` : "") + (trxId ? ` • TrxID ${trxId}` : ""),
            module: "bkash",
            run: () => api(`/api/people/${p._id}/transactions`, {
                method: "POST",
                body: JSON.stringify({ type: a.type, amount, counterparty: a.counterparty || undefined, trxId: trxId || undefined, notes: a.notes || undefined }),
            }),
        };
    },

    async entry_add(a) {
        const date = cleanDate(a.date);
        if (!date) return { error: "Tarikh YYYY-MM-DD format e dao" };
        const list = (a.entries || []).map((e) => ({ number: cleanPhone(e.number), amount: cleanAmount(e.amount), raw: e }));
        const bad = list.filter((e) => !e.number || !e.amount);
        if (!list.length) return { error: "Kono entry nai" };
        if (bad.length) return { error: `Ei gulo bhul: ${bad.map((b) => `${b.raw.number} ${b.raw.amount}`).join(", ")}. Number 11 digit (01...) ar amount lagbe.` };
        const entries = list.map(({ number, amount }) => ({ number, amount }));
        const total = entries.reduce((s, e) => s + e.amount, 0);
        const deposit = cleanAmount(a.deposit) || 0;
        return {
            summary: `এন্ট্রি • ${date} • ${entries.length} টা • মোট ${money(total)}` + (deposit ? ` • জমা ${money(deposit)}` : "")
                + "\n" + entries.map((e) => `${e.number} — ${money(e.amount)}`).join("\n"),
            module: "entry",
            run: () => api("/entries", {
                method: "POST",
                body: JSON.stringify({
                    date, entries, total, count: entries.length, deposit,
                    raw: entries.map((e) => `${e.number} ${e.amount}`).join("\n"),
                }),
            }),
        };
    },

    async pawna_transaction(a) {
        const amount = cleanAmount(a.amount);
        if (!amount) return { error: "Amount thik nai" };
        if (!["send", "receive"].includes(a.type)) return { error: "type hobe send ba receive" };
        const list = await M("Pawna").find({}, "name").lean();
        let f = findByName(list, a.name);
        let isNew = false;
        if (f.error) {
            if (!a.create_if_missing || !String(a.name || "").trim()) return f;
            isNew = true;
        }
        const name = isNew ? String(a.name).trim() : f.item.name;
        const label = a.type === "send" ? "দিলাম (সে দেবে)" : "পেলাম (ফেরত)";
        return {
            summary: `পাওনা • ${name}${isNew ? " (নতুন মানুষ)" : ""} • ${label} • ${money(amount)}` + (a.notes ? ` • ${a.notes}` : ""),
            module: "pawna",
            run: async () => {
                let id = isNew ? null : f.item._id;
                if (isNew) id = (await api("/api/pawna/people", { method: "POST", body: JSON.stringify({ name }) })).person.id;
                return api(`/api/pawna/people/${id}/transactions`, {
                    method: "POST", body: JSON.stringify({ type: a.type, amount, notes: a.notes || null }),
                });
            },
        };
    },

    async bank_transaction(a) {
        const f = findByName(await M("Bank").find({}, "name").lean(), a.bank);
        if (f.error) return f;
        const amount = cleanAmount(a.amount);
        if (!amount) return { error: "Amount thik nai" };
        if (!["deposit", "withdraw"].includes(a.type)) return { error: "type hobe deposit ba withdraw" };
        const label = a.type === "deposit" ? "জমা" : "উত্তোলন";
        return {
            summary: `ব্যাংক • ${f.item.name} • ${label} • ${money(amount)}` + (a.name ? ` • ${a.name}` : "") + (a.notes ? ` • ${a.notes}` : ""),
            module: "bank",
            run: () => api(`/api/banks/${f.item._id}/transactions`, {
                method: "POST", body: JSON.stringify({ type: a.type, amount, name: a.name || null, notes: a.notes || null }),
            }),
        };
    },

    async cash_transaction(a) {
        const amount = cleanAmount(a.amount);
        if (!amount) return { error: "Amount thik nai" };
        if (!["given", "taken"].includes(a.type)) return { error: "type hobe given ba taken" };
        const label = a.type === "given" ? "দিয়েছি (ক্যাশ কমবে)" : "পেয়েছি (ক্যাশ বাড়বে)";
        return {
            summary: `ক্যাশ • ${label} • ${money(amount)}` + (a.name ? ` • ${a.name}` : ""),
            module: "cash",
            run: () => api("/api/cash/transactions", {
                method: "POST", body: JSON.stringify({ type: a.type, amount, name: a.name || null }),
            }),
        };
    },

    async gila_pieces(a) {
        const f = findByName(await M("Gila").find({}, "name entries").lean(), a.name);
        if (f.error) return f;
        const date = cleanDate(a.date);
        if (!date) return { error: "Tarikh YYYY-MM-DD format e dao" };
        const pieces = Number(toEn(a.pieces));
        if (!Number.isFinite(pieces) || pieces < 0) return { error: "Piece shonkha thik nai" };
        const old = (f.item.entries || []).find((e) => e.date === date);
        const finalPieces = a.mode === "add" ? (old ? old.pieces : 0) + pieces : pieces;
        return {
            summary: `গিলা • ${f.item.name} • ${date} • ${finalPieces} পিস` + (old ? ` (আগে ছিল ${old.pieces})` : ""),
            module: "gila",
            run: () => api(`/Gila/persons/${f.item._id}/entries/${date}`, {
                method: "PUT", body: JSON.stringify({ pieces: finalPieces }),
            }),
        };
    },
};

/* ============================================================
   TOOL DEFINITIONS (AI ke bola hoy ki ki korte pare)
   ============================================================ */
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const num = (description) => ({ type: "number", description });
const fn = (name, description, properties, required = []) =>
    ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });

const TOOLS = [
    fn("get_overview", "Shob hisab er bortoman obostha: bKash balance + limit, bank, cash, pawna, gila, aajker entry.", {}),
    fn("get_entries", "Kono ekta tarikh er Entry (bKash entry manager) er total/count/joma.", { date: str("YYYY-MM-DD") }, ["date"]),
    fn("get_history", "Kono manush/bank er recent lenden.", {
        module: str("bkash | pawna | bank | cash | gila", { enum: ["bkash", "pawna", "bank", "cash", "gila"] }),
        name: str("Manush ba bank er nam (cash er jonno lagbe na)"),
        limit: num("Koyta (default 10)"),
    }, ["module"]),

    fn("bkash_transaction", "bKash account e send/receive transaction. 'X er account theke pathalam' = send, 'X er account e aslo' = receive.", {
        person: str("bKash account er nam ba number (list theke)"),
        type: str("send | receive", { enum: ["send", "receive"] }),
        amount: num("Taka"),
        counterparty: str("Kake pathano/kar theke asha (number ba nam), optional"),
        trxId: str("TrxID thakle"),
        notes: str("optional"),
    }, ["person", "type", "amount"]),

    fn("entry_add", "Entry Manager e number + amount er list add (WhatsApp hisab er moto). Ek shathe onek entry.", {
        date: str("YYYY-MM-DD, na bolle aajke"),
        entries: { type: "array", items: { type: "object", properties: { number: str("11 digit 01..."), amount: num("Taka") }, required: ["number", "amount"] } },
        deposit: num("Joma (optional)"),
    }, ["entries"]),

    fn("pawna_transaction", "Pawna hisab. send = ami take taka dilam/dhar dilam (se amake debe). receive = se amake ferot dilo.", {
        name: str("Manush er nam"),
        type: str("send | receive", { enum: ["send", "receive"] }),
        amount: num("Taka"),
        notes: str("optional"),
        create_if_missing: { type: "boolean", description: "Nam list e na thakle notun manush banabe — shudhu user sposhto bolle true" },
    }, ["name", "type", "amount"]),

    fn("bank_transaction", "Bank e joma (deposit) ba uttolon (withdraw).", {
        bank: str("Bank er nam (list theke)"),
        type: str("deposit | withdraw", { enum: ["deposit", "withdraw"] }),
        amount: num("Taka"),
        name: str("Ke joma/uthalo, optional"),
        notes: str("optional"),
    }, ["bank", "type", "amount"]),

    fn("cash_transaction", "Hate thaka cash. given = cash diye dilam (kombe), taken = cash pelam (barbe).", {
        type: str("given | taken", { enum: ["given", "taken"] }),
        amount: num("Taka"),
        name: str("Kake/kar theke, optional"),
    }, ["type", "amount"]),

    fn("gila_pieces", "Gila hisab e kono din er piece shonkha. mode 'add' = ager shathe jog, 'set' = oi diner piece eta-i.", {
        name: str("Manush er nam"),
        date: str("YYYY-MM-DD, na bolle aajke"),
        pieces: num("Piece shonkha"),
        mode: str("add | set", { enum: ["add", "set"] }),
    }, ["name", "pieces", "mode"]),
];

const READERS = { get_overview: getOverview, get_entries: getEntries, get_history: getHistory };

/* ---------- pending action store (Confirm er jonno) ---------- */
const pending = new Map();
const TTL = 15 * 60 * 1000;

function savePending(action) {
    const id = crypto.randomUUID();
    pending.set(id, { ...action, at: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.at > TTL) pending.delete(k);
    return id;
}

async function confirmPending(id) {
    const a = pending.get(id);
    if (!a) throw new Error("Ei kaj ta aar nai (meyad shesh ba age-i hoye geche). Abar bolo.");
    pending.delete(id);
    await a.run();
    return { summary: a.summary, module: a.module };
}

function cancelPending(id) { return pending.delete(id); }

/* AI tool call chalay. write hole pending action banay. */
async function runTool(name, args, actions) {
    if (READERS[name]) return READERS[name](args || {});
    if (WRITERS[name]) {
        const r = await WRITERS[name](args || {});
        if (r.error) return { error: r.error };
        const id = savePending(r);
        actions.push({ id, summary: r.summary, module: r.module });
        return { status: "prepared_waiting_for_user_confirm", summary: r.summary };
    }
    return { error: `Unknown tool ${name}` };
}

module.exports = { TOOLS, runTool, confirmPending, cancelPending, namesForPrompt, dayKey };
