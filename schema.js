const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    bkashNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    whatsappNumber: String,
    photo: String,
    initialBalance: {
        type: Number,
        default: 0
    },
    // "Already used" amounts — only counted if the key matches today/this month
    dailyUsedBase: {
        type: Number,
        default: 0
    },
    monthlyUsedBase: {
        type: Number,
        default: 0
    },
    transactions: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Transaction',
            
        }
    ],
    baseDayKey: String,      // "2026-09-28"
    baseMonthKey: String     // "2026-09"
});

const TransactionSchema = new mongoose.Schema({
    person: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Person',
        required: true
    },
    type: {
        type: String,
        enum: ['send', 'receive'],
        required: true
    },
    amount: {
        type: Number,
        required: true
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