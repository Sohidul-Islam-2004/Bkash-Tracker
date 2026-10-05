/* ============================================================
   TIMEZONE — MUST BE FIRST
   ============================================================ */
process.env.TZ = "Asia/Dhaka";

/* ============================================================
   IMPORTS
   ============================================================ */
require("dotenv").config();
const cron = require('node-cron');
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
   USAGE — reads directly from the person's stored counters
   (with day/month reset applied)
   ============================================================ */
function getUsage(person) {
    const now = new Date();
    const tKey = dayKey(now);
    const mKey = monthKey(now);

    const dailyUsed =
        person.baseDayKey === tKey ? Number(person.dailyUsedBase) || 0 : 0;
    const monthlyUsed =
        person.baseMonthKey === mKey ? Number(person.monthlyUsedBase) || 0 : 0;

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

        const u = getUsage(person);

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

/* Create transaction — MUTATES the person's balance and limits */
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

    const now = new Date();
    const tKey = dayKey(now);
    const mKey = monthKey(now);

    /* Current effective usage (with reset logic applied) */
    const curDaily =
        person.baseDayKey === tKey ? Number(person.dailyUsedBase) || 0 : 0;
    const curMonthly =
        person.baseMonthKey === mKey ? Number(person.monthlyUsedBase) || 0 : 0;

    /* Server-side checks for send */
    if (type === "send") {
        if (curDaily >= DAILY_LIMIT) {
            throw new HttpError(400, "exceeds daily limit");
        }
        if (curMonthly >= MONTHLY_LIMIT) {
            throw new HttpError(400, "exceeds monthly limit");
        }
        if (curDaily + amount > DAILY_LIMIT) {
            throw new HttpError(400, "exceeds daily limit");
        }
        if (curMonthly + amount > MONTHLY_LIMIT) {
            throw new HttpError(400, "exceeds monthly limit");
        }
        if (amount > Number(person.initialBalance || 0)) {
            throw new HttpError(400, "not enough balance");
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

    /* Create the transaction record */
    const transaction = await Transaction.create({
        person: personId,
        type,
        amount,
        date: date ? new Date(date) : now,
        counterparty: counterparty || undefined,
        trxId: cleanTrx || undefined,
        verified: Boolean(cleanTrx),
        notes: notes || undefined
    });

    /* ----------------------------------------------------------
       MUTATE THE PERSON
       — Reset day counter if a new day has started
       — Reset month counter if a new month has started
       — Apply the transaction effect
       ---------------------------------------------------------- */
    if (person.baseDayKey !== tKey) {
        person.dailyUsedBase = 0;
        person.baseDayKey = tKey;
    }
    if (person.baseMonthKey !== mKey) {
        person.monthlyUsedBase = 0;
        person.baseMonthKey = mKey;
    }

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

/* Both URLs are used by the frontend */
app.post("/api/transactions/:id", wrap(createTransaction));
app.post("/api/people/:id/transactions", wrap(createTransaction));

/* ----------------------------------------------------------
   Delete transaction — removes ONLY the record.
   Balance and limits stay unchanged (frozen snapshot).
   ---------------------------------------------------------- */
app.delete(
    "/api/transactions/:id",
    wrap(async (req, res) => {
        if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");

        const transaction = await Transaction.findByIdAndDelete(req.params.id);
        if (!transaction) throw new HttpError(404, "Transaction not found");

        /* Only remove the reference — do NOT touch balance or counters */
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
}); app.patch(
    "/api/people/bandle/:id",
    wrap(async (req, res) => {
        if (!isId(req.params.id)) throw new HttpError(400, "Invalid id");

        const { bundleCount, bundleExpiry } = req.body;

        const update = {};
        if (bundleCount !== undefined) update.bundleCount = toNumber(bundleCount);
        if (bundleExpiry !== undefined) update.bundleExpiry = bundleExpiry;

        const person = await Person.findByIdAndUpdate(
            req.params.id,
            update,
            { new: true, runValidators: true }
        );

        if (!person) throw new HttpError(404, "Person not found");

        res.json(person);
    })
);
/* ============================================================
   START
   ============================================================ */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`Today: ${dayKey(new Date())}`);
});




// Schedule task to run every day at 12:00 AM (Midnight)
cron.schedule('0 0 * * *', async () => {

    try {
        const result = await Person.updateMany(
            { bundleExpiry: { $gt: 0 } },
            { $inc: { bundleExpiry: -1 } }
        );

        console.log(`Updated ${result.modifiedCount} active bundles.`);
    } catch (error) {
        console.error('Error updating bundle expiry in MongoDB:', error);
    }
});



module.exports = app;