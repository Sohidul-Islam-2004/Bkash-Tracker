/* ============================================================
   দেনা পাওনার হিসাব  —  /api/pawna/people
   ============================================================ */
const express = require("express");
const mongoose = require("mongoose");
const { PawnaPerson } = require("../models");

const router = express.Router();

function summarize(person) {
    const totalSend = person.totalSend || 0;
    const totalReceive = person.totalReceive || 0;
    const net = totalSend - totalReceive;
    return { totalSend, totalReceive, net, status: net > 0 ? "pabe" : net < 0 ? "debe" : "soman" };
}

router.get("/api/pawna/people", async (req, res) => {
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

router.post("/api/pawna/people", async (req, res) => {
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

router.post("/api/pawna/people/:id/transactions", async (req, res) => {
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

router.delete("/api/pawna/people/:id/transactions/:txnId", async (req, res) => {
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

router.delete("/api/pawna/people/:id", async (req, res) => {
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

module.exports = router;
