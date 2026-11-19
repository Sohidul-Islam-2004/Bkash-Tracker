/* ============================================================
   TEST DATA — notun (khali) database e nokol hisab bosay
   Chalao:  node seed.js
   Shudhu khali database e chole. Data thakle kichu kore na (ashol data bachate).
   ============================================================ */
process.env.TZ = "Asia/Dhaka";
require("dotenv").config();
require("node:dns").setServers(["1.1.1.1", "8.8.8.8"]); // server.js er motoi — local DNS mongodb+srv khuje pay na
const mongoose = require("mongoose");
const S = require("./schema");

const Person = mongoose.model("Person", S.PersonSchema);
const Transaction = mongoose.model("Transaction", S.TransactionSchema);
const Entries = mongoose.model("Entries", S.EntriesSchema);
const Gila = mongoose.model("Gila", S.GilaPersonSchema);
const Pawna = mongoose.model("Pawna", S.PawnaPersonSchema);
const Bank = mongoose.model("Bank", S.BankSchema);
const Cash = mongoose.model("Cash", S.CashSchema);

const day = (offset) => {
    const d = new Date(); d.setDate(d.getDate() - offset);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const ago = (offset, hour = 11) => { const d = new Date(); d.setDate(d.getDate() - offset); d.setHours(hour, 0, 0, 0); return d; };
const rndNum = () => "01" + "3456789"[Math.floor(Math.random() * 7)] + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

(async () => {
    if (!process.env.DB_URL) throw new Error(".env e DB_URL nai");
    await mongoose.connect(process.env.DB_URL);
    const dbName = mongoose.connection.db.databaseName;
    console.log(`Database: ${dbName}`);

    const counts = await Promise.all([Person, Entries, Gila, Pawna, Bank, Cash].map((m) => m.countDocuments()));
    if (counts.some((c) => c > 0)) {
        console.log("⚠ Ei database e agei data ache. Ashol data bachate kichu kora holo na.");
        console.log("  Test er jonno khali database er DB_URL dao.");
        return mongoose.disconnect();
    }

    const today = day(0), dKey = today, mKey = today.slice(0, 7);

    /* ---------- bKash accounts + transactions ---------- */
    const [salam, hasan, rafi] = await Person.create([
        { name: "Salam", bkashNumber: "01711223344", initialBalance: 42500, dailyUsedBase: 38000, monthlyUsedBase: 185000, baseDayKey: dKey, baseMonthKey: mKey, bundleCount: 3, bundleExpiry: ago(-2) },
        { name: "Hasan", bkashNumber: "01812345678", initialBalance: 18200, dailyUsedBase: 5000, monthlyUsedBase: 62000, baseDayKey: dKey, baseMonthKey: mKey, bundleCount: 0 },
        { name: "Rafi", bkashNumber: "01912345678", initialBalance: 650, dailyUsedBase: 0, monthlyUsedBase: 12000, baseDayKey: dKey, baseMonthKey: mKey },
    ]);
    const tx = [
        [salam, "send", 15000, 0, "01755555555", "BKA1X9QZ"], [salam, "send", 23000, 0, "01866666666", null],
        [salam, "receive", 10000, 0, "01611111111", "BKA2P0LM"], [salam, "send", 12000, 2, "01755555555", null],
        [hasan, "send", 5000, 0, "Karim", null], [hasan, "receive", 7000, 1, "01522222222", "BKA3T7RW"],
        [hasan, "send", 9000, 4, "01755555555", null], [rafi, "send", 4000, 5, "01933333333", null],
    ];
    for (const [p, type, amount, offset, counterparty, trxId] of tx) {
        const t = await Transaction.create({ person: p._id, type, amount, date: ago(offset), counterparty, trxId, verified: !!trxId });
        await Person.updateOne({ _id: p._id }, { $push: { transactions: t._id } });
    }

    /* ---------- Entry (shesh 10 din) ---------- */
    for (let i = 9; i >= 0; i--) {
        if (i === 6) continue; // ekdin faka
        const n = 3 + Math.floor(Math.random() * 6);
        const entries = Array.from({ length: n }, () => ({ number: rndNum(), amount: (1 + Math.floor(Math.random() * 20)) * 500 }));
        const total = entries.reduce((s, e) => s + e.amount, 0);
        await Entries.create({
            date: day(i), raw: entries.map((e) => `${e.number} ${e.amount}`).join("\n"),
            entries, total, count: n, deposit: i % 3 === 0 ? 30000 : 0,
        });
    }

    /* ---------- Pawna ---------- */
    await Pawna.create([
        { name: "Rahim", totalSend: 15000, totalReceive: 5000, transactions: [{ type: "send", amount: 15000, date: ago(40), notes: "dokan er jonno" }, { type: "receive", amount: 5000, date: ago(12) }] },
        { name: "Jamal", totalSend: 3000, totalReceive: 3000, transactions: [{ type: "send", amount: 3000, date: ago(20) }, { type: "receive", amount: 3000, date: ago(3) }] },
        { name: "Kabir", totalSend: 0, totalReceive: 8000, transactions: [{ type: "receive", amount: 8000, date: ago(6), notes: "agrim nilam" }] },
    ]);

    /* ---------- Bank ---------- */
    const banks = [
        { name: "DBBL", accountNumber: "1051100012345", txns: [["deposit", 120000, 25], ["withdraw", 30000, 10], ["deposit", 45000, 1]] },
        { name: "Islami Bank", accountNumber: "20501230000456", txns: [["deposit", 80000, 30], ["withdraw", 15000, 2]] },
    ];
    for (const b of banks) {
        const transactions = b.txns.map(([type, amount, off]) => ({ _id: new mongoose.Types.ObjectId(), type, amount, date: ago(off), name: null, notes: null }));
        const totalDeposit = transactions.filter((t) => t.type === "deposit").reduce((s, t) => s + t.amount, 0);
        const totalWithdraw = transactions.filter((t) => t.type === "withdraw").reduce((s, t) => s + t.amount, 0);
        await Bank.collection.insertOne({ name: b.name, accountNumber: b.accountNumber, createdAt: ago(60), transactions, totalDeposit, totalWithdraw });
    }

    /* ---------- Cash ---------- */
    await Cash.create({
        balance: 24500,
        transactions: [
            { type: "taken", amount: 30000, date: ago(3), name: "Hasan" },
            { type: "given", amount: 5500, date: ago(1), name: "Hasan" },
        ],
    });

    /* ---------- Gila ---------- */
    await Gila.create([
        { name: "Karim", advance: 5000, price: 50, entries: [day(8), day(7), day(6)].map((d, i) => ({ date: d, pieces: 10 + i * 2 })) },
        { name: "Nasima", advance: 3000, price: 40, entries: [3, 2, 1, 0].map((o) => ({ date: day(o), pieces: 8 })) },
    ]);

    console.log("✓ Test data bosano holo: 3 bKash account, 8 transaction, 9 diner Entry, 3 Pawna, 2 Bank, Cash, 2 Gila");
    await mongoose.disconnect();
})().catch((e) => { console.error("✕", e.message); process.exit(1); });
