/* ============================================================
   সালাম ভাইয়ের সাথে লেনদেন  —  /entries
   ============================================================ */
const express = require("express");
const { Entries } = require("../models");

const router = express.Router();

const ENTRY_PHONE_RE = /^01[3-9]\d{8}$/;

router.post("/entries", async (req, res) => {
    try {
        const body = req.body || {};
        const date = String(body.date || "");
        const list = Array.isArray(body.entries) ? body.entries : [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || list.length === 0) {
            return res.status(400).json({ message: "date and entries required" });
        }

        /* প্রতিটা এন্ট্রি সার্ভারেও যাচাই — ভুল নম্বর / ভুল টাকা সেভ হবে না */
        const entries = [];
        const ids = new Set();
        for (const e of list) {
            const number = String((e && e.number) || "").trim();
            const amount = Number(e && e.amount);
            if (!ENTRY_PHONE_RE.test(number)) {
                return res.status(400).json({ message: `নম্বর ভুল: ${number || "(খালি)"}` });
            }
            if (!Number.isFinite(amount) || amount <= 0) {
                return res.status(400).json({ message: `টাকা ভুল: ${number}` });
            }
            const item = { number, amount };
            if (e.msgId) {
                const id = String(e.msgId);
                if (ids.has(id)) {
                    return res.status(400).json({ message: `একই মেসেজ দুইবার এসেছে: ${number} = ${amount}` });
                }
                ids.add(id);
                item.msgId = id;
            }
            if (e.at && !Number.isNaN(new Date(e.at).getTime())) item.at = new Date(e.at);
            entries.push(item);
        }

        /* একই WhatsApp মেসেজ আগে সেভ হয়ে থাকলে আবার সেভ হবে না */
        if (ids.size) {
            const clash = await Entries.findOne({ "entries.msgId": { $in: [...ids] } }).lean();
            if (clash) {
                const dup = clash.entries.filter((x) => x.msgId && ids.has(x.msgId));
                return res.status(409).json({
                    message: `${dup.length} টা মেসেজ আগেই সেভ আছে (${clash.date}) — যেমন ${dup[0].number} = ${dup[0].amount}`,
                    duplicates: dup.map((x) => ({ number: x.number, amount: x.amount, date: clash.date })),
                });
            }
        }

        /* মোট ও সংখ্যা সার্ভার নিজে হিসাব করে — ক্লায়েন্টের পাঠানো মোট নেওয়া হয় না */
        const total = entries.reduce((s, e) => s + e.amount, 0);
        const dep = Number(body.deposit);
        const deposit = Number.isFinite(dep) && dep >= 0 ? dep : 0;

        const saved = await Entries.create({
            date,
            raw: typeof body.raw === "string" ? body.raw : "",
            entries,
            total,
            deposit,
            count: entries.length,
        });
        res.status(201).json(saved);
    } catch (err) {
        console.error("POST /entries failed:", err);
        res.status(500).json({ message: err.message });
    }
});

router.get("/entries", async (req, res) => {
    try {
        const data = await Entries.find().sort({ createdAt: 1 }).lean();
        res.status(200).json(data);
    } catch (err) {
        console.error("GET /entries failed:", err);
        res.status(500).json({ message: err.message });
    }
});

router.delete("/entries/by-date/:date", async (req, res) => {
    try {
        /* এক তারিখে একাধিক রেকর্ড থাকতে পারে — সবগুলো মুছতে হবে */
        const del = await Entries.deleteMany({ date: req.params.date });
        if (!del.deletedCount) return res.status(404).json({ ok: false, message: "এই তারিখে কোনো এন্ট্রি পাওয়া যায়নি" });
        return res.json({ ok: true, deletedCount: del.deletedCount });
    } catch (err) {
        console.error("delete error:", err);
        return res.status(500).json({ ok: false, message: err.message || "সার্ভার ত্রুটি" });
    }
});

module.exports = router;
