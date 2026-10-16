/* ============================================================
   TIMEZONE — MUST BE FIRST
   ============================================================ */
process.env.TZ = "Asia/Dhaka";

/* ============================================================
   IMPORTS
   ============================================================ */
require("dotenv").config();
const cron = require("node-cron");
const path = require("path");
const dns = require("node:dns");
const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const {
    PersonSchema,
    TransactionSchema,
    EntriesSchema,
    GilaPersonSchema,
    PawnaPersonSchema,
    BankSchema,
    UserSchema,
} = require("./schema");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

/* ============================================================
   APP + MIDDLEWARE
   ============================================================ */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   DATABASES
   ============================================================ */
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);
const BUCKET = "Bkash";

const Person = mongoose.model("Person", PersonSchema);
const Transaction = mongoose.model("Transaction", TransactionSchema);
const Entries = mongoose.model("Entries", EntriesSchema);
const Gila = mongoose.model("Gila", GilaPersonSchema);
const PawnaPerson = mongoose.model("Pawna", PawnaPersonSchema);
const Bank = mongoose.model("Bank", BankSchema);
const User = mongoose.model("User", UserSchema);

mongoose
    .connect(process.env.DB_URL)
    .then(() => console.log("Cloud Database connected successfully!"))
    .catch((err) => console.error("Cloud DB connection error:", err));

/* ============================================================
   FILE UPLOAD
   ============================================================ */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

/* ============================================================
   LIMITS
   ============================================================ */
const DAILY_LIMIT = 50000;
const MONTHLY_LIMIT = 300000;

/* ============================================================
   HELPERS
   ============================================================ */
const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const isId = (id) => mongoose.Types.ObjectId.isValid(id);

const toNumber = (value, fallback = 0) => {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

function dayKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function monthKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

/* ============================================================
   SUPABASE PHOTO HELPERS
   ============================================================ */
async function uploadPhoto(file) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `ProfileImage/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file.buffer, {
        contentType: file.mimetype, upsert: false,
    });
    if (error) throw new HttpError(400, "photo upload failed: " + error.message);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
}

async function deletePhoto(url) {
    if (!url) return;
    try {
        const marker = `/object/public/${BUCKET}/`;
        const i = url.indexOf(marker);
        if (i === -1) return;
        const storagePath = decodeURIComponent(url.slice(i + marker.length));
        const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
        if (error) console.error("photo delete failed:", error.message);
    } catch (err) {
        console.error("photo delete failed:", err.message);
    }
}

/* ============================================================
   USAGE
   ============================================================ */
function getUsage(person) {
    const now = new Date();
    const tKey = dayKey(now);
    const mKey = monthKey(now);
    const dailyUsed = person.baseDayKey === tKey ? Number(person.dailyUsedBase) || 0 : 0;
    const monthlyUsed = person.baseMonthKey === mKey ? Number(person.monthlyUsedBase) || 0 : 0;
    return {
        dailyUsed, monthlyUsed,
        remDaily: DAILY_LIMIT - dailyUsed,
        remMonthly: MONTHLY_LIMIT - monthlyUsed,
    };
}

/* ============================================================
   ROUTES — PEOPLE
   ============================================================ */
app.post("/api/people", upload.single("photo"), wrap(async (req, res) => {
    const { name, bkashNumber, whatsappNumber, initialBalance, dailyUsedBase, monthlyUsedBase, baseDayKey, baseMonthKey } = req.body;
    const photo = req.file ? await uploadPhoto(req.file) : null;
    const now = new Date();
    const person = await Person.create({
        name, bkashNumber,
        whatsappNumber: whatsappNumber || undefined,
        photo,
        initialBalance: toNumber(initialBalance),
        dailyUsedBase: toNumber(dailyUsedBase),
        monthlyUsedBase: toNumber(monthlyUsedBase),
        baseDayKey: baseDayKey || dayKey(now),
        baseMonthKey: baseMonthKey || monthKey(now),
    });
    res.status(201).json(person);
}));

app.get("/api/people", wrap(async (req, res) => {
    const people = await Person.find().populate("transactions").sort({ createdAt: -1 });
    res.json(people);
}));

app.get("/api/people/:id", wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const person = await Person.findById(req.params.id).populate("transactions");
    if (!person) throw new HttpError(404, "Person not found");
    res.json(person);
}));

app.get("/api/people/:id/usage", wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const person = await Person.findById(req.params.id);
    if (!person) throw new HttpError(404, "Person not found");
    const u = getUsage(person);
    res.json({
        dailyLimit: DAILY_LIMIT, monthlyLimit: MONTHLY_LIMIT,
        ...u,
        dailyBlocked: u.remDaily <= 0,
        monthlyBlocked: u.remMonthly <= 0,
    });
}));

app.patch("/api/people/:id", upload.single("photo"), wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const update = {};
    const b = req.body || {};
    if (b.name !== undefined) update.name = b.name;
    if (b.whatsappNumber !== undefined) update.whatsappNumber = b.whatsappNumber;
    if (b.initialBalance !== undefined) update.initialBalance = toNumber(b.initialBalance);
    if (b.dailyUsedBase !== undefined) update.dailyUsedBase = toNumber(b.dailyUsedBase);
    if (b.monthlyUsedBase !== undefined) update.monthlyUsedBase = toNumber(b.monthlyUsedBase);
    if (b.baseDayKey !== undefined) update.baseDayKey = b.baseDayKey;
    if (b.baseMonthKey !== undefined) update.baseMonthKey = b.baseMonthKey;

    let oldPhoto = null;
    if (req.file) {
        const existing = await Person.findById(req.params.id).select("photo");
        oldPhoto = existing && existing.photo;
        update.photo = await uploadPhoto(req.file);
    }
    const person = await Person.findByIdAndUpdate(req.params.id, update, {
        new: true, runValidators: true,
    }).populate("transactions");
    if (!person) throw new HttpError(404, "Person not found");
    if (req.file) await deletePhoto(oldPhoto);
    res.json(person);
}));

app.delete("/api/people/:id", wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const person = await Person.findByIdAndDelete(req.params.id);
    if (!person) throw new HttpError(404, "Person not found");
    await Transaction.deleteMany({ person: req.params.id });
    await deletePhoto(person.photo);
    res.json({ msg: "ok" });
}));

/* ============================================================
   ROUTES — TRANSACTIONS
   ============================================================ */
async function createTransaction(req, res) {
    const personId = req.params.id;
    if (!isId(personId)) throw new HttpError(400, "Invalid id");
    const { type, counterparty, date, trxId, notes } = req.body;
    const amount = Number(req.body.amount);

    if (!["send", "receive"].includes(type)) throw new HttpError(400, "Invalid transaction type");
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Amount must be more than 0");

    const person = await Person.findById(personId);
    if (!person) throw new HttpError(404, "Person not found");

    const now = new Date();
    const tKey = dayKey(now);
    const mKey = monthKey(now);
    const curDaily = person.baseDayKey === tKey ? Number(person.dailyUsedBase) || 0 : 0;
    const curMonthly = person.baseMonthKey === mKey ? Number(person.monthlyUsedBase) || 0 : 0;

    if (type === "send") {
        if (curDaily >= DAILY_LIMIT) throw new HttpError(400, "exceeds daily limit");
        if (curMonthly >= MONTHLY_LIMIT) throw new HttpError(400, "exceeds monthly limit");
        if (curDaily + amount > DAILY_LIMIT) throw new HttpError(400, "exceeds daily limit");
        if (curMonthly + amount > MONTHLY_LIMIT) throw new HttpError(400, "exceeds monthly limit");
        if (amount > Number(person.initialBalance || 0)) throw new HttpError(400, "not enough balance");
    }

    const cleanTrx = trxId ? String(trxId).toUpperCase().trim() : null;
    if (cleanTrx) {
        const dup = await Transaction.findOne({ person: personId, trxId: cleanTrx });
        if (dup) throw new HttpError(400, "TrxID already exists");
    }

    const transaction = await Transaction.create({
        person: personId, type, amount,
        date: date ? new Date(date) : now,
        counterparty: counterparty || undefined,
        trxId: cleanTrx || undefined,
        verified: Boolean(cleanTrx),
        notes: notes || undefined,
    });

    if (person.baseDayKey !== tKey) { person.dailyUsedBase = 0; person.baseDayKey = tKey; }
    if (person.baseMonthKey !== mKey) { person.monthlyUsedBase = 0; person.baseMonthKey = mKey; }

    if (type === "send") {
        person.bundleCount = Number(person.bundleCount) - 1;
        person.initialBalance = Number(person.initialBalance) - amount;
        person.dailyUsedBase = Number(person.dailyUsedBase) + amount;
        person.monthlyUsedBase = Number(person.monthlyUsedBase) + amount;
    } else {
        person.initialBalance = Number(person.initialBalance) + amount;
    }

    person.transactions.push(transaction._id);
    await person.save();
    res.status(201).json(transaction);
}

app.post("/api/transactions/:id", wrap(createTransaction));
app.post("/api/people/:id/transactions", wrap(createTransaction));

app.delete("/api/transactions/:id", wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const transaction = await Transaction.findByIdAndDelete(req.params.id);
    if (!transaction) throw new HttpError(404, "Transaction not found");
    await Person.findByIdAndUpdate(transaction.person, { $pull: { transactions: transaction._id } });
    res.json({ msg: "ok" });
}));

/* ============================================================
   BUNDLE UPDATE
   ============================================================ */
app.patch("/api/people/bandle/:id", wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const { bundleCount, bundleExpiry } = req.body;
    const update = {};
    if (bundleCount !== undefined) {
        update.bundleCount = toNumber(bundleCount);
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30);
        update.bundleExpiry = expiry;
    } else if (bundleExpiry !== undefined) {
        update.bundleExpiry = bundleExpiry ? new Date(bundleExpiry) : null;
    }
    const person = await Person.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!person) throw new HttpError(404, "Person not found");
    res.json(person);
}));

/* ============================================================
   ENTRIES (bKash)
   ============================================================ */
app.post("/entries", async (req, res) => {
    try {
        const { date, entries, total, count, raw, deposit } = req.body;
        if (!date || !Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ message: "date and entries required" });
        }
        const safeTotal = Number(total) || entries.reduce((s, e) => s + (+e.amount || 0), 0);
        const safeCount = Number(count) || entries.length;
        const saved = await Entries.create({ date, raw: raw || "", entries, total: safeTotal, deposit, count: safeCount });
        res.status(201).json(saved);
    } catch (err) {
        console.error("POST /api/entries failed:", err);
        res.status(500).json({ message: err.message });
    }
});

app.get("/entries", async (req, res) => {
    try {
        const data = await Entries.find().sort({ createdAt: 1 }).lean();
        res.status(200).json(data);
    } catch (err) {
        console.error("GET /entries failed:", err);
        res.status(500).json({ message: err.message });
    }
});

app.delete("/entries/by-date/:date", async (req, res) => {
    try {
        const del = await Entries.findOneAndDelete({ date: req.params.date });
        if (!del) return res.status(404).json({ ok: false, message: "এই তারিখে কোনো এন্ট্রি পাওয়া যায়নি" });
        return res.json({ ok: true, deleted: del });
    } catch (err) {
        console.error("delete error:", err);
        return res.status(500).json({ ok: false, message: err.message || "সার্ভার ত্রুটি" });
    }
});

/* ============================================================
   GILA
   ============================================================ */
app.get("/Gila/persons", async (req, res) => {
    const data = await Gila.find();
    res.json(data.map((p) => ({
        id: p._id, name: p.name, advance: p.advance, price: p.price,
        totalPieces: (p.entries || []).reduce((s, e) => s + (e.pieces || 0), 0),
    })));
});

app.post("/Gila/persons", async (req, res) => {
    const { name, advance, price } = req.body;
    const data = await Gila.create({ name, advance, price });
    res.status(201).json({ id: data._id, name: data.name, advance: data.advance, price: data.price, totalPieces: 0 });
});

app.put("/Gila/persons/:id", async (req, res) => {
    const { name, advance, price } = req.body;
    const data = await Gila.findByIdAndUpdate(req.params.id, { name, advance, price }, { new: true });
    if (!data) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    res.json({
        id: data._id, name: data.name, advance: data.advance, price: data.price,
        totalPieces: (data.entries || []).reduce((s, e) => s + (e.pieces || 0), 0),
    });
});

app.delete("/Gila/persons/:id", async (req, res) => {
    const data = await Gila.findByIdAndDelete(req.params.id);
    if (!data) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    res.status(204).end();
});

app.get("/Gila/persons/:id/entries", async (req, res) => {
    const person = await Gila.findById(req.params.id);
    if (!person) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    res.json(person.entries);
});

app.put("/Gila/persons/:id/entries/:date", async (req, res) => {
    const { pieces } = req.body;
    const { id, date } = req.params;
    const person = await Gila.findById(id);
    if (!person) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    const existing = person.entries.find((e) => e.date === date);
    if (existing) existing.pieces = pieces;
    else person.entries.push({ date, pieces });
    await person.save();
    const saved = person.entries.find((e) => e.date === date);
    res.json({ id: saved._id, personId: person._id, date: saved.date, pieces: saved.pieces });
});

app.delete("/Gila/persons/:id/entries/:date", async (req, res) => {
    const { id, date } = req.params;
    const person = await Gila.findById(id);
    if (!person) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    person.entries = person.entries.filter((e) => e.date !== date);
    await person.save();
    res.status(204).end();
});

/* ============================================================
   PAWNA
   ============================================================ */
function summarize(person) {
    const totalSend = person.totalSend || 0;
    const totalReceive = person.totalReceive || 0;
    const net = totalSend - totalReceive;
    return { totalSend, totalReceive, net, status: net > 0 ? "pabe" : net < 0 ? "debe" : "soman" };
}

app.get("/api/pawna/people", async (req, res) => {
    try {
        const people = await PawnaPerson.find().sort({ createdAt: -1 });
        const out = people.map((p) => ({
            id: p._id.toString(), name: p.name, createdAt: p.createdAt,
            summary: summarize(p),
            transactions: (p.transactions || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date))
                .map((t) => ({ id: t._id.toString(), type: t.type, amount: t.amount, date: t.date, notes: t.notes ?? null })),
        }));
        res.json({ people: out });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "সার্ভার ত্রুটি" });
    }
});

app.post("/api/pawna/people", async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || "").trim();
        if (!name) return res.status(400).json({ message: "নাম দিতে হবে" });
        const person = await PawnaPerson.create({ name, totalSend: 0, totalReceive: 0, transactions: [] });
        res.status(201).json({
            person: { id: person._id.toString(), name: person.name, createdAt: person.createdAt, summary: summarize(person), transactions: [] },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "সার্ভার ত্রুটি" });
    }
});

app.post("/api/pawna/people/:id/transactions", async (req, res) => {
    try {
        const body = req.body || {};
        const { type } = body;
        const amount = Number(body.amount);
        if (type !== "send" && type !== "receive") return res.status(400).json({ message: "type অবশ্যই send অথবা receive" });
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: "amount ধনাত্মক হতে হবে" });

        const txn = { type, amount, date: body.date ? new Date(body.date) : new Date(), notes: body.notes ?? null };
        const person = await PawnaPerson.findByIdAndUpdate(
            req.params.id,
            { $push: { transactions: txn }, $inc: type === "send" ? { totalSend: amount } : { totalReceive: amount } },
            { new: true, runValidators: true }
        );
        if (!person) return res.status(404).json({ message: "মানুষ খুঁজে পাওয়া যায়নি" });

        const created = person.transactions[person.transactions.length - 1];
        res.status(201).json({
            transaction: { id: created._id.toString(), type: created.type, amount: created.amount, date: created.date, notes: created.notes ?? null },
            summary: summarize(person),
        });
    } catch (err) {
        console.error(err);
        if (err.name === "CastError") return res.status(400).json({ message: "ভুল আইডি" });
        res.status(500).json({ message: "সার্ভার ত্রুটি" });
    }
});

app.delete("/api/pawna/people/:id/transactions/:txnId", async (req, res) => {
    try {
        const { id, txnId } = req.params;
        const person = await PawnaPerson.findById(id);
        if (!person) return res.status(404).json({ message: "মানুষ খুঁজে পাওয়া যায়নি" });
        const txn = person.transactions.id(txnId);
        if (!txn) return res.status(404).json({ message: "লেনদেন খুঁজে পাওয়া যায়নি" });
        person.transactions.pull(txnId);
        await person.save();
        res.json({ ok: true, summary: summarize(person) });
    } catch (err) {
        console.error(err);
        if (err.name === "CastError") return res.status(400).json({ message: "ভুল আইডি" });
        res.status(500).json({ message: "সার্ভার ত্রুটি" });
    }
});

app.delete("/api/pawna/people/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "ভুল আইডি" });
        const person = await PawnaPerson.findById(id);
        if (!person) return res.status(404).json({ message: "মানুষ খুঁজে পাওয়া যায়নি" });
        await PawnaPerson.deleteOne({ _id: person._id });
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "মুছতে পারা যায়নি" });
    }
});

/* ============================================================
   BANK
   ============================================================ */
function computeTotalsFromTransactions(transactions) {
    let totalDeposit = 0, totalWithdraw = 0;
    (transactions || []).forEach((t) => {
        const a = Number(t.amount || 0);
        if (t.type === "withdraw") totalWithdraw += a;
        else totalDeposit += a;
    });
    return { totalDeposit, totalWithdraw };
}

function bankSummary(bank) {
    let totalDeposit, totalWithdraw;
    if (typeof bank.totalDeposit === "number" && typeof bank.totalWithdraw === "number") {
        totalDeposit = bank.totalDeposit;
        totalWithdraw = bank.totalWithdraw;
    } else {
        const t = computeTotalsFromTransactions(bank.transactions);
        totalDeposit = t.totalDeposit;
        totalWithdraw = t.totalWithdraw;
    }
    return { totalDeposit, totalWithdraw, balance: totalDeposit - totalWithdraw };
}

function shapeBank(b) {
    const txns = (b.transactions || []).slice().sort((a, c) => new Date(a.date) - new Date(c.date));
    return {
        id: b._id.toString(), name: b.name, accountNumber: b.accountNumber || "",
        createdAt: b.createdAt, summary: bankSummary(b),
        transactions: txns.map((t) => ({
            id: t._id.toString(), type: t.type, amount: t.amount, date: t.date,
            name: t.name ?? null, notes: t.notes ?? null,
        })),
    };
}

async function ensureTotals(bank) {
    if (typeof bank.totalDeposit === "number" && typeof bank.totalWithdraw === "number") return bank;
    const { totalDeposit, totalWithdraw } = computeTotalsFromTransactions(bank.transactions);
    await Bank.collection.updateOne({ _id: bank._id }, { $set: { totalDeposit, totalWithdraw } });
    bank.totalDeposit = totalDeposit;
    bank.totalWithdraw = totalWithdraw;
    return bank;
}

app.get("/api/banks", wrap(async (req, res) => {
    const banks = await Bank.find().sort({ createdAt: 1 }).lean();
    const out = [];
    for (const b of banks) { await ensureTotals(b); out.push(shapeBank(b)); }
    res.json({ banks: out });
}));

app.post("/api/banks", wrap(async (req, res) => {
    const name = String((req.body && req.body.name) || "").trim();
    const accountNumber = String((req.body && req.body.accountNumber) || "").trim();
    if (!name) throw new HttpError(400, "নাম দিতে হবে");
    const bank = await Bank.create({ name, accountNumber });
    await Bank.collection.updateOne({ _id: bank._id }, { $set: { totalDeposit: 0, totalWithdraw: 0 } });
    const fresh = await Bank.findById(bank._id).lean();
    res.status(201).json({ bank: shapeBank(fresh) });
}));

app.delete("/api/banks/:id", wrap(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "ভুল আইডি");
    const bank = await Bank.findById(id);
    if (!bank) throw new HttpError(404, "ব্যাংক খুঁজে পাওয়া যায়নি");
    await Bank.deleteOne({ _id: bank._id });
    res.json({ ok: true });
}));

app.post("/api/banks/:id/transactions", wrap(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "ভুল আইডি");
    const bank = await Bank.findById(id).lean();
    if (!bank) throw new HttpError(404, "ব্যাংক খুঁজে পাওয়া যায়নি");
    await ensureTotals(bank);

    const body = req.body || {};
    const { type } = body;
    const amount = Number(body.amount);
    if (type !== "deposit" && type !== "withdraw") throw new HttpError(400, "type অবশ্যই deposit অথবা withdraw");
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "amount ধনাত্মক হতে হবে");

    const txn = {
        _id: new mongoose.Types.ObjectId(), type, amount,
        date: body.date ? new Date(body.date) : new Date(),
        name: body.name ? String(body.name).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
    };

    await Bank.collection.updateOne(
        { _id: bank._id },
        {
            $push: { transactions: txn },
            $inc: {
                totalDeposit: type === "deposit" ? amount : 0,
                totalWithdraw: type === "withdraw" ? amount : 0,
            },
        }
    );

    const fresh = await Bank.findById(id).lean();
    res.status(201).json({
        transaction: { id: txn._id.toString(), type: txn.type, amount: txn.amount, date: txn.date, name: txn.name, notes: txn.notes },
        summary: bankSummary(fresh),
    });
}));

app.delete("/api/banks/:id/transactions/:txnId", wrap(async (req, res) => {
    const { id, txnId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(txnId)) throw new HttpError(400, "ভুল আইডি");
    const bank = await Bank.findById(id).lean();
    if (!bank) throw new HttpError(404, "ব্যাংক খুঁজে পাওয়া যায়নি");
    await ensureTotals(bank);

    const result = await Bank.collection.updateOne(
        { _id: bank._id },
        { $pull: { transactions: { _id: new mongoose.Types.ObjectId(txnId) } } }
    );

    if (result.matchedCount === 0) throw new HttpError(404, "ব্যাংক খুঁজে পাওয়া যায়নি");
    if (result.modifiedCount === 0) throw new HttpError(404, "লেনদেন খুঁজে পাওয়া যায়নি");

    const fresh = await Bank.findById(id).lean();
    res.json({ ok: true, summary: bankSummary(fresh) });
}));

/* ============================================================
   AUTH — no tokens, just plain user objects
   ============================================================ */
const newId = () => "u_" + crypto.randomBytes(6).toString("hex");
const hashPin = (pin) => crypto.createHash("sha256").update(String(pin)).digest("hex");

function normalizePhone(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.startsWith("880")) d = d.slice(3);
    else if (d.startsWith("88")) d = d.slice(2);
    if (d.length === 10 && d.startsWith("1")) d = "0" + d;
    return /^01[3-9]\d{8}$/.test(d) ? d : "";
}

const publicUser = (u) => ({ id: u.id, phone: u.phone, createdAt: u.createdAt });

/* POST /api/auth/check */
app.post("/api/auth/check", wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ message: "অবৈধ নম্বর" });
    const user = await User.findOne({ phone }).lean();
    res.json({ exists: !!user });
}));

/* POST /api/auth/register */
app.post("/api/auth/register", wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const pin = String(req.body?.pin || "");

    if (!phone) return res.status(400).json({ message: "অবৈধ নম্বর" });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ message: "৪ ডিজিটের পিন দিন" });

    const existing = await User.findOne({ phone });
    if (existing) return res.status(409).json({ message: "এই নম্বরে অ্যাকাউন্ট আছে" });

    const user = await User.create({ id: newId(), phone, pin: hashPin(pin) });
    res.status(201).json({ user: publicUser(user) });
}));

/* POST /api/auth/login */
app.post("/api/auth/login", wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const pin = String(req.body?.pin || "");

    if (!phone || !/^\d{4}$/.test(pin)) return res.status(400).json({ message: "অবৈধ ইনপুট" });

    const user = await User.findOne({ phone });
    if (!user || user.pin !== hashPin(pin)) return res.status(401).json({ message: "ভুল পিন!" });

    res.json({ user: publicUser(user) });
}));

/* POST /api/auth/reset-pin */
app.post("/api/auth/reset-pin", wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const pin = String(req.body?.pin || "");

    if (!phone) return res.status(400).json({ message: "অবৈধ নম্বর" });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ message: "৪ ডিজিটের পিন দিন" });

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ message: "অ্যাকাউন্ট পাওয়া যায়নি" });

    user.pin = hashPin(pin);
    await user.save();

    res.json({ user: publicUser(user) });
}));

/* POST /api/auth/me — pass { id } in body */
app.post("/api/auth/me", wrap(async (req, res) => {
    const id = String(req.body?.id || "").trim();
    if (!id) return res.status(400).json({ message: "id দরকার" });

    const user = await User.findOne({ id });
    if (!user) return res.status(401).json({ message: "সেশন অবৈধ" });

    res.json({ user: publicUser(user) });
}));

/* POST /api/auth/logout */
app.post("/api/auth/logout", (_req, res) => res.json({ ok: true }));

/* ============================================================
   ERROR HANDLER — MUST BE LAST
   ============================================================ */
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err.code === 11000) {
        return res.status(400).json({ error: "Already exists" });
    }
    if (err.name === "ValidationError") {
        return res.status(400).json({
            error: Object.values(err.errors).map((e) => e.message).join(", "),
        });
    }

    const status = err.status || 500;
    if (status === 500) console.error(err);

    res.status(status).json({
        error: status === 500 ? "Internal server error" : err.message,
    });
});

/* ============================================================
   START
   ============================================================ */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`Today: ${dayKey(new Date())}`);
});

cron.schedule("0 0 * * *", async () => {
    try {
        const result = await Person.updateMany(
            { bundleExpiry: { $lte: new Date() } },
            { $set: { bundleCount: 0, bundleExpiry: null } }
        );
        console.log(`Expired ${result.modifiedCount} bundles.`);
    } catch (err) {
        console.error("Bundle expiry cron failed:", err.message);
    }
});

module.exports = app;