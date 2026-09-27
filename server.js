const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const { Person, Transaction } = require("./models");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

/* ---------------- limits (fixed) ---------------- */
const DAILY_LIMIT = 50000;
const MONTHLY_LIMIT = 300000;

/* ---------------- helpers ---------------- */
function dayKey(d = new Date()) {
    return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
}

function monthKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function summarize(person, transactions) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let dailyUsed = 0;
    let monthlyUsed = 0;
    let balance = person.initialBalance || 0;

    for (const t of transactions) {
        const amt = t.amount;
        const dt = new Date(t.date);

        if (t.type === "send") {
            if (dt >= startOfDay) dailyUsed += amt;
            if (dt >= startOfMonth) monthlyUsed += amt;
            balance -= amt;
        } else if (t.type === "receive") {
            balance += amt;
        }
    }

    // add the "already used" numbers only if they were entered today / this month
    if (person.baseDayKey === dayKey(now)) dailyUsed += person.dailyUsedBase || 0;
    if (person.baseMonthKey === monthKey(now)) monthlyUsed += person.monthlyUsedBase || 0;

    return {
        balance,
        dailyUsed,
        monthlyUsed,
        dailyLimit: DAILY_LIMIT,
        monthlyLimit: MONTHLY_LIMIT,
        remainingDaily: DAILY_LIMIT - dailyUsed,
        remainingMonthly: MONTHLY_LIMIT - monthlyUsed
    };
}

/* =====================================================
   PEOPLE
===================================================== */

// GET all people (with summary)
app.get("/api/people", async (req, res) => {
    try {
        const people = await Person.find().sort({ createdAt: -1 });

        const result = [];
        for (const p of people) {
            const txns = await Transaction.find({ person: p._id });
            result.push({
                ...p.toObject(),
                ...summarize(p, txns)
            });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET one person (with transactions)
app.get("/api/people/:id", async (req, res) => {
    try {
        const person = await Person.findById(req.params.id);
        if (!person) return res.status(404).json({ error: "not found" });

        const txns = await Transaction.find({ person: person._id }).sort({ date: -1 });

        res.json({
            ...person.toObject(),
            ...summarize(person, txns),
            transactions: txns
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST new person
app.post("/api/people", async (req, res) => {
    try {
        const now = new Date();
        const person = await Person.create({
            name: req.body.name,
            bkashNumber: req.body.bkashNumber,
            whatsappNumber: req.body.whatsappNumber || null,
            photo: req.body.photo || null,
            initialBalance: req.body.initialBalance || 0,
            dailyUsedBase: req.body.dailyUsedBase || 0,
            monthlyUsedBase: req.body.monthlyUsedBase || 0,
            baseDayKey: dayKey(now),
            baseMonthKey: monthKey(now)
        });
        res.status(201).json(person);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH update person
app.patch("/api/people/:id", async (req, res) => {
    try {
        const now = new Date();
        const update = {};

        if (req.body.name !== undefined) update.name = req.body.name;
        if (req.body.bkashNumber !== undefined) update.bkashNumber = req.body.bkashNumber;
        if (req.body.whatsappNumber !== undefined) update.whatsappNumber = req.body.whatsappNumber;
        if (req.body.photo !== undefined) update.photo = req.body.photo;
        if (req.body.initialBalance !== undefined) update.initialBalance = req.body.initialBalance;

        if (req.body.dailyUsedBase !== undefined) {
            update.dailyUsedBase = req.body.dailyUsedBase;
            update.baseDayKey = dayKey(now);
        }
        if (req.body.monthlyUsedBase !== undefined) {
            update.monthlyUsedBase = req.body.monthlyUsedBase;
            update.baseMonthKey = monthKey(now);
        }

        const person = await Person.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!person) return res.status(404).json({ error: "not found" });

        res.json(person);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE person (also deletes their transactions)
app.delete("/api/people/:id", async (req, res) => {
    try {
        const person = await Person.findByIdAndDelete(req.params.id);
        if (!person) return res.status(404).json({ error: "not found" });

        await Transaction.deleteMany({ person: person._id });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* =====================================================
   TRANSACTIONS
===================================================== */

// POST transaction
app.post("/api/people/:id/transactions", async (req, res) => {
    try {
        const person = await Person.findById(req.params.id);
        if (!person) return res.status(404).json({ error: "person not found" });

        const { type, amount } = req.body;

        if (!["send", "receive"].includes(type)) {
            return res.status(400).json({ error: "type must be send or receive" });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "amount must be > 0" });
        }

        // limit check for sends
        if (type === "send") {
            const txns = await Transaction.find({ person: person._id });
            const s = summarize(person, txns);
            if (amount > s.remainingDaily) {
                return res.status(400).json({ error: "exceeds daily limit" });
            }
            if (amount > s.remainingMonthly) {
                return res.status(400).json({ error: "exceeds monthly limit" });
            }
        }

        // TrxID check
        const trxId = req.body.trxId ? String(req.body.trxId).toUpperCase().trim() : null;
        if (trxId) {
            const dup = await Transaction.findOne({ person: person._id, trxId });
            if (dup) return res.status(400).json({ error: "TrxID already exists" });
        }

        const txn = await Transaction.create({
            person: person._id,
            type,
            amount,
            date: req.body.date ? new Date(req.body.date) : new Date(),
            counterparty: req.body.counterparty || null,
            trxId,
            verified: !!trxId,
            notes: req.body.notes || null
        });

        res.status(201).json(txn);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE transaction
app.delete("/api/transactions/:id", async (req, res) => {
    try {
        const txn = await Transaction.findByIdAndDelete(req.params.id);
        if (!txn) return res.status(404).json({ error: "not found" });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* =====================================================
   START
===================================================== */
const PORT = process.env.PORT || 4000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB connected");
        app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
    })
    .catch(err => {
        console.error("MongoDB connection failed:", err.message);
        process.exit(1);
    });