const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    bkashNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    whatsappNumber: { type: String, trim: true },
    photo: String,

    initialBalance: {
        type: Number,
        default: 0
    },

    dailyUsedBase: {
        type: Number,
        default: 0
    },
    monthlyUsedBase: {
        type: Number,
        default: 0
    },
    baseDayKey: String,      // "2026-09-30"
    baseMonthKey: String,    // "2026-09"

    transactions: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Transaction"
        }
    ]
}, { timestamps: true });

const TransactionSchema = new mongoose.Schema({
    person: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Person",
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ["send", "receive"],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    date: {
        type: Date,
        default: Date.now
    },
    counterparty: String,
    trxId: String,
    verified: {
        type: Boolean,
        default: false
    },
    notes: String
});

module.exports = {
    PersonSchema,
    TransactionSchema
};