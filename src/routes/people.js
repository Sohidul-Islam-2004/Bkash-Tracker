/* ============================================================
   বিকাশ ম্যানেজমেন্ট  —  /api/people, /api/transactions
   ============================================================ */
const express = require("express");
const { Person, Transaction } = require("../models");
const { wrap, HttpError, isId, toNumber } = require("../lib/http");
const { dayKey, monthKey } = require("../lib/dates");
const { upload, uploadPhoto, deletePhoto } = require("../lib/photos");
const { DAILY_LIMIT, MONTHLY_LIMIT } = require("../config");

const router = express.Router();

/* ---------- আজ ও এই মাসে কত খরচ হয়েছে ---------- */
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

/* ---------- PEOPLE ---------- */
router.post("/api/people", upload.single("photo"), wrap(async (req, res) => {
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

router.get("/api/people", wrap(async (req, res) => {
    const people = await Person.find().populate("transactions").sort({ createdAt: -1 });
    res.json(people);
}));

router.get("/api/people/:id", wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const person = await Person.findById(req.params.id).populate("transactions");
    if (!person) throw new HttpError(404, "Person not found");
    res.json(person);
}));

router.get("/api/people/:id/usage", wrap(async (req, res) => {
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

router.patch("/api/people/:id", upload.single("photo"), wrap(async (req, res) => {
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

router.delete("/api/people/:id", wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const person = await Person.findByIdAndDelete(req.params.id);
    if (!person) throw new HttpError(404, "Person not found");
    await Transaction.deleteMany({ person: req.params.id });
    await deletePhoto(person.photo);
    res.json({ msg: "ok" });
}));

/* ---------- TRANSACTIONS ---------- */
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

router.post("/api/transactions/:id", wrap(createTransaction));
router.post("/api/people/:id/transactions", wrap(createTransaction));

router.delete("/api/transactions/:id", wrap(async (req, res) => {
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");
    const transaction = await Transaction.findByIdAndDelete(req.params.id);
    if (!transaction) throw new HttpError(404, "Transaction not found");
    await Person.findByIdAndUpdate(transaction.person, { $pull: { transactions: transaction._id } });
    res.json({ msg: "ok" });
}));

/* ---------- SEND MONEY BUNDLE ---------- */
router.patch("/api/people/bandle/:id", wrap(async (req, res) => {
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

module.exports = router;
