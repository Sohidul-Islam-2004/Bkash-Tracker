/* ============================================================
   ব্যাংক হিসাব  —  /api/banks
   ============================================================ */
const express = require("express");
const mongoose = require("mongoose");
const { Bank } = require("../models");
const { wrap, HttpError } = require("../lib/http");

const router = express.Router();

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

router.get("/api/banks", wrap(async (req, res) => {
    const banks = await Bank.find().sort({ createdAt: 1 }).lean();
    const out = [];
    for (const b of banks) { await ensureTotals(b); out.push(shapeBank(b)); }
    res.json({ banks: out });
}));

router.post("/api/banks", wrap(async (req, res) => {
    const name = String((req.body && req.body.name) || "").trim();
    const accountNumber = String((req.body && req.body.accountNumber) || "").trim();
    if (!name) throw new HttpError(400, "নাম দিতে হবে");
    const bank = await Bank.create({ name, accountNumber });
    await Bank.collection.updateOne({ _id: bank._id }, { $set: { totalDeposit: 0, totalWithdraw: 0 } });
    const fresh = await Bank.findById(bank._id).lean();
    res.status(201).json({ bank: shapeBank(fresh) });
}));

router.delete("/api/banks/:id", wrap(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "ভুল আইডি");
    const bank = await Bank.findById(id);
    if (!bank) throw new HttpError(404, "ব্যাংক খুঁজে পাওয়া যায়নি");
    await Bank.deleteOne({ _id: bank._id });
    res.json({ ok: true });
}));

router.post("/api/banks/:id/transactions", wrap(async (req, res) => {
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

router.delete("/api/banks/:id/transactions/:txnId", wrap(async (req, res) => {
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

module.exports = router;
