/* ============================================================
   IMPORTS
   ============================================================ */
require("dotenv").config();

const path = require("path");
const dns = require("node:dns");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const { PersonSchema, TransactionSchema } = require("./schema");

/* DNS — helps MongoDB Atlas connect on some hosts */
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

mongoose
    .connect(process.env.DB_URL)
    .then(() => console.log("Cloud Database connected successfully!"))
    .catch((err) => console.error("Cloud DB connection error:", err));

/* ============================================================
   FILE UPLOAD
   ============================================================ */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
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
        d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0")
    );
}

/* ============================================================
   SUPABASE PHOTO HELPERS
   ============================================================ */
async function uploadPhoto(file) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `ProfileImage/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false
        });

    if (error) {
        throw new HttpError(400, "photo upload failed: " + error.message);
    }

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
        const { error } = await supabase.storage
            .from(BUCKET)
            .remove([storagePath]);

        if (error) console.error("photo delete failed:", error.message);
    } catch (err) {
        console.error("photo delete failed:", err.message);
    }
}

/* ============================================================
   USAGE CALCULATOR
   ============================================================ */
async function getUsage(person) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const txns = await Transaction.find({
        person: person._id,
        type: "send"
    });

    let dailyUsed = 0;
    let monthlyUsed = 0;

    for (const t of txns) {
        const dt = new Date(t.date);
        if (dt >= startOfDay) dailyUsed += Number(t.amount) || 0;
        if (dt >= startOfMonth) monthlyUsed += Number(t.amount) || 0;
    }

    if (person.baseDayKey === dayKey(now)) {
        dailyUsed += Number(person.dailyUsedBase) || 0;
    }
    if (person.baseMonthKey === monthKey(now)) {
        monthlyUsed += Number(person.monthlyUsedBase) || 0;
    }

    return {
        dailyUsed,
        monthlyUsed,
        remDaily: DAILY_LIMIT - dailyUsed,
        remMonthly: MONTHLY_LIMIT - monthlyUsed
    };
}

/* ============================================================
   ROUTES — PEOPLE
   ============================================================ */

/* Create person */
app.post(
    "/api/people",
    upload.single("photo"),
    wrap(async (req, res) => {
        const {
            name,
            bkashNumber,
            whatsappNumber,
            initialBalance,
            dailyUsedBase,
            monthlyUsedBase,
            baseDayKey,
            baseMonthKey
        } = req.body;

        const photo = req.file ? await uploadPhoto(req.file) : null;
        const now = new Date();

        const person = await Person.create({
            name,
            bkashNumber,
            whatsappNumber: whatsappNumber || undefined,
            photo,
            initialBalance: toNumber(initialBalance),
            dailyUsedBase: toNumber(dailyUsedBase),
            monthlyUsedBase: toNumber(monthlyUsedBase),
            baseDayKey: baseDayKey || dayKey(now),
            baseMonthKey: baseMonthKey || monthKey(now)
        });

        res.status(201).json(person);
    })
);

/* List all people */
app.get(
    "/api/people",
    wrap(async (req, res) => {
        const people = await Person.find()
            .populate("transactions")
            .sort({ createdAt: -1 });

        res.json(people);
    })
);

/* Get one person */
app.get(
    "/api/people/:id",
    wrap(async (req, res) => {
        if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");

        const person = await Person.findById(req.params.id).populate("transactions");
        if (!person) throw new HttpError(404, "Person not found");

        res.json(person);
    })
);

/* Get current usage for one person */
app.get(
    "/api/people/:id/usage",
    wrap(async (req, res) => {
        if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");

        const person = await Person.findById(req.params.id);
        if (!person) throw new HttpError(404, "Person not found");

        const u = await getUsage(person);

        res.json({
            dailyLimit: DAILY_LIMIT,
            monthlyLimit: MONTHLY_LIMIT,
            ...u,
            dailyBlocked: u.remDaily <= 0,
            monthlyBlocked: u.remMonthly <= 0
        });
    })
);

/* Update person (limits, photo, etc.) */
app.patch(
    "/api/people/:id",
    upload.single("photo"),
    wrap(async (req, res) => {
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
            new: true,
            runValidators: true
        }).populate("transactions");

        if (!person) throw new HttpError(404, "Person not found");

        if (req.file) await deletePhoto(oldPhoto);
        res.json(person);
    })
);

/* Delete person + transactions + photo */
app.delete(
    "/api/people/:id",
    wrap(async (req, res) => {
        if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");

        const person = await Person.findByIdAndDelete(req.params.id);
        if (!person) throw new HttpError(404, "Person not found");

        await Transaction.deleteMany({ person: req.params.id });
        await deletePhoto(person.photo);

        res.json({ msg: "ok" });
    })
);

/* ============================================================
   ROUTES — TRANSACTIONS
   ============================================================ */

async function createTransaction(req, res) {
    const personId = req.params.id;
    if (!isId(personId)) throw new HttpError(400, "Invalid id");

    const { type, counterparty, date, trxId, notes } = req.body;
    const amount = Number(req.body.amount);

    if (!["send", "receive"].includes(type)) {
        throw new HttpError(400, "Invalid transaction type");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpError(400, "Amount must be more than 0");
    }

    const person = await Person.findById(personId);
    if (!person) throw new HttpError(404, "Person not found");

    /* Server-side limit check for send */
    if (type === "send") {
        const u = await getUsage(person);

        if (u.remDaily <= 0) {
            throw new HttpError(400, "exceeds daily limit");
        }
        if (u.remMonthly <= 0) {
            throw new HttpError(400, "exceeds monthly limit");
        }
        if (amount > u.remDaily) {
            throw new HttpError(400, "exceeds daily limit");
        }
        if (amount > u.remMonthly) {
            throw new HttpError(400, "exceeds monthly limit");
        }
    }

    /* Duplicate TrxID check */
    const cleanTrx = trxId ? String(trxId).toUpperCase().trim() : null;
    if (cleanTrx) {
        const dup = await Transaction.findOne({
            person: personId,
            trxId: cleanTrx
        });
        if (dup) throw new HttpError(400, "TrxID already exists");
    }

    const transaction = await Transaction.create({
        person: personId,
        type,
        amount,
        date: date ? new Date(date) : new Date(),
        counterparty: counterparty || undefined,
        trxId: cleanTrx || undefined,
        verified: Boolean(cleanTrx),
        notes: notes || undefined
    });

    await Person.findByIdAndUpdate(personId, {
        $push: { transactions: transaction._id }
    });

    res.status(201).json(transaction);
}

/* Both URLs are used by the frontend */
app.post("/api/transactions/:id", wrap(createTransaction));
app.post("/api/people/:id/transactions", wrap(createTransaction));

/* Delete transaction */
app.delete(
    "/api/transactions/:id",
    wrap(async (req, res) => {
        if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");

        const transaction = await Transaction.findByIdAndDelete(req.params.id);
        if (!transaction) throw new HttpError(404, "Transaction not found");

        await Person.findByIdAndUpdate(transaction.person, {
            $pull: { transactions: transaction._id }
        });

        res.json({ msg: "ok" });
    })
);

/* ============================================================
   ERROR HANDLER
   ============================================================ */
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err.code === 11000) {
        return res.status(400).json({ error: "This bKash number is already added" });
    }
    if (err.name === "ValidationError") {
        return res.status(400).json({
            error: Object.values(err.errors)
                .map((e) => e.message)
                .join(", ")
        });
    }

    const status = err.status || 500;
    if (status === 500) console.error(err);

    res.status(status).json({
        error: status === 500 ? "Internal server error" : err.message
    });
});

/* ============================================================
   START
   ============================================================ */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

module.exports = app;