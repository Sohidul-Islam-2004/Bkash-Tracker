const mongoose = require('mongoose');

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
        baseDayKey: { type: String, default: null },  // "2026-09-30"
        baseMonthKey: { type: String, default: null },  // "2026-09"

        /* Send money bundle */
        bundleCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        bundleExpiry: {
            type: Date,
            default: null,        // was `Number` — comment said "2026-10-15" (a date)
        },

        transactions: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Transaction',
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
            ref: 'Person',
            required: true,
        },
        type: {
            type: String,
            enum: ['send', 'receive'],
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

/* ============================================================
   ENTRIES  (general ledger)
   ============================================================ */
const EntriesSchema = new mongoose.Schema(
    {
        date: { type: String, required: true, index: true }, // "YYYY-MM-DD"
        raw: { type: String, default: '' },
        entries: [
            {
                _id: false,
                number: { type: String, required: true },
                amount: { type: Number, required: true, min: 1 },
            },
        ],
        deposit: { type: Number, default: 0, min: 0 },
        total: { type: Number, required: true, default: 0 },
        count: { type: Number, required: true, default: 0 },
    },
    { timestamps: true },
);


const GilaPersonSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        advance: { type: Number, required: true, default: 0, min: 0 },
        price: { type: Number, required: true, default: 0, min: 0 },

        entries: [
            {
                date: { type: String, required: true }, // "YYYY-MM-DD"
                pieces: { type: Number, default: 0, min: 0 },
            },
        ],
    },
    { timestamps: true },
);

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
        partialFilterExpression: { trxId: { $type: 'string' } },
    },
);

EntriesSchema.index({ date: 1, createdAt: 1 });


/* Fast lookup of a single embedded gila entry by date */
GilaPersonSchema.index({ 'entries.date': 1 });

/* ============================================================
   EXPORTS
   ============================================================ */
module.exports = {
    PersonSchema,
    TransactionSchema,
    EntriesSchema,
    GilaPersonSchema,

};