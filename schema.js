const mongoose = require("mongoose");

/* ============================================================
   PERSON
   ============================================================ */
const PersonSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        bkashNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        whatsappNumber: {
            type: String,
            trim: true,
        },
        photo: {
            type: String,
            default: null,
        },

        initialBalance: {
            type: Number,
            default: 0,
            min: 0,
        },

        /* "Already used" baseline amounts */
        dailyUsedBase: {
            type: Number,
            default: 0,
            min: 0,
        },
        monthlyUsedBase: {
            type: Number,
            default: 0,
            min: 0,
        },
        baseDayKey: String, // "2026-09-30"
        baseMonthKey: String, // "2026-09"
        baseDayKey: String, // "2026-09-30"
        baseMonthKey: String, // "2026-09"

        /* Send money bundle */
        bundleCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        bundleExpiry: {
            type: Number, // "2026-10-15"
            default: null,
        },

        transactions: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Transaction",
            },
        ],
    },
    { timestamps: true },
);

/* ============================================================
   TRANSACTION
   ============================================================ */
const TransactionSchema = new mongoose.Schema(
    {
        person: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Person",
            required: true,
        },
        type: {
            type: String,
            enum: ["send", "receive"],
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        date: {
            type: Date,
            default: Date.now,
        },
        counterparty: {
            type: String,
            default: null,
            trim: true,
        },
        trxId: {
            type: String,
            default: null,
            trim: true,
            uppercase: true,
        },
        verified: {
            type: Boolean,
            default: false,
        },
        notes: {
            type: String,
            default: null,
            trim: true,
        },
    },
    { timestamps: true },
);

const EntriesSchema = new mongoose.Schema(
    {
        date: { type: String, required: true, index: true }, // "YYYY-MM-DD"
        raw: { type: String, default: "" },
        entries: [
            {
                _id: false,
                number: { type: String, required: true },
                amount: { type: Number, required: true, min: 1 },
            },
        ],
        total: { type: Number, required: true, default: 0 },
        count: { type: Number, required: true, default: 0 },
    },
    { timestamps: true },
);

EntriesSchema.index({ date: 1, createdAt: 1 });

/* ============================================================
   INDEXES
   ============================================================ */
PersonSchema.index({ createdAt: -1 });

TransactionSchema.index({ person: 1, date: -1 });
TransactionSchema.index({ person: 1, type: 1, date: -1 });
TransactionSchema.index(
    { person: 1, trxId: 1 },
    {
        unique: true,
        partialFilterExpression: { trxId: { $type: "string" } },
    },
);

module.exports = {
    PersonSchema,
    TransactionSchema,
    EntriesSchema
};
