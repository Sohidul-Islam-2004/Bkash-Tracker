/* ============================================================
   ক্যাশের হিসাব  —  /api/cash
   ============================================================ */
const express = require("express");
const mongoose = require("mongoose");
const { Cash } = require("../models");
const { wrap, HttpError } = require("../lib/http");

const router = express.Router();

// GET - Fetch current balance and history
router.get("/api/cash", wrap(async (req, res) => {
    let cash = await Cash.findOne();
    if (!cash) cash = await Cash.create({ balance: 0 });

    res.json({
        balance: cash.balance || 0,
        transactions: (cash.transactions || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date))
            .map((t) => ({
                id: t._id.toString(),
                type: t.type,
                amount: t.amount,
                date: t.date,
                name: t.name ?? null,
            })),
    });
}));

// PATCH - Direct balance edit (No transactions created)
router.patch("/api/cash/balance", wrap(async (req, res) => {
    const newBalance = Number(req.body.balance);
    if (!Number.isFinite(newBalance)) throw new HttpError(400, "সঠিক পরিমাণ দিন");

    const cash = await Cash.findOneAndUpdate(
        {},
        { $set: { balance: newBalance } },
        { new: true, upsert: true }
    );

    res.json({ balance: cash.balance });
}));

// POST - Add transaction (Given subtracts, Taken adds)
router.post("/api/cash/transactions", wrap(async (req, res) => {
    const { type, name } = req.body;
    const amount = Number(req.body.amount);

    if (type !== "given" && type !== "taken") throw new HttpError(400, "ভুল ধরন");
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "সঠিক পরিমাণ দিন");

    const txn = {
        type,
        amount,
        date: new Date(),
        name: name ? String(name).trim() : null,
    };

    // Calculate balance change: given = -, taken = +
    const balanceChange = type === "given" ? -amount : amount;

    const cash = await Cash.findOneAndUpdate(
        {},
        {
            $push: { transactions: txn },
            $inc: { balance: balanceChange }
        },
        { new: true, upsert: true }
    );

    const created = cash.transactions[cash.transactions.length - 1];
    res.status(201).json({
        transaction: {
            id: created._id.toString(),
            type: created.type,
            amount: created.amount,
            date: created.date,
            name: created.name ?? null,
        },
        balance: cash.balance
    });
}));

// DELETE - Remove transaction (Does NOT change balance)
router.delete("/api/cash/transactions/:txnId", wrap(async (req, res) => {
    const { txnId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(txnId)) throw new HttpError(400, "ভুল আইডি");

    const cash = await Cash.findOne();
    if (!cash) throw new HttpError(404, "ডেটা নেই");

    // Remove from array only, DO NOT touch the main balance
    cash.transactions.pull(txnId);
    await cash.save();

    res.json({ ok: true, balance: cash.balance });
}));

// DELETE - Reset everything to 0
router.delete("/api/cash/reset", wrap(async (req, res) => {
    const cash = await Cash.findOne();
    if (cash) {
        cash.balance = 0;
        cash.transactions = [];
        await cash.save();
    } else {
        await Cash.create({ balance: 0, transactions: [] });
    }
    res.json({ ok: true, balance: 0 });
}));

module.exports = router;
