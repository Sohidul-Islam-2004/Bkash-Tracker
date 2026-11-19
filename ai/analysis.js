/* ============================================================
   HISAB ANALYSIS — shob hishab server e kora hoy (AI jeno bhul jog-biyog na kore)
   period: today | week (7 din) | month (ei mash) | all
   ============================================================ */
const mongoose = require("mongoose");
const M = (name) => mongoose.model(name);

const DAILY_LIMIT = 50000;
const MONTHLY_LIMIT = 300000;
/* Entry page er "হাসান পাওনা" shuru (public/Entry/script.js er InitialCarry er sathe mil rakho) */
const ENTRY_INITIAL_CARRY = Number(process.env.ENTRY_INITIAL_CARRY || 648990);

function dayKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const monthKey = (d = new Date()) => dayKey(d).slice(0, 7);

function periodStart(period) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "week") start.setDate(start.getDate() - 6);
    else if (period === "month") start.setDate(1);
    else if (period === "all") return new Date(0);
    return start;
}
const inPeriod = (d, start) => new Date(d) >= start;
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);

async function analyze({ period = "today" } = {}) {
    if (!["today", "week", "month", "all"].includes(period)) period = "today";
    const start = periodStart(period);
    const startKey = period === "all" ? "0000-00-00" : dayKey(start);
    const now = new Date();
    const tKey = dayKey(now), mKey = monthKey(now);

    const [people, txns, entries, pawna, banks, cash, gila] = await Promise.all([
        M("Person").find({}, "name bkashNumber initialBalance dailyUsedBase monthlyUsedBase baseDayKey baseMonthKey bundleCount bundleExpiry").lean(),
        M("Transaction").find({ date: { $gte: start } }, "person type amount counterparty date").lean(),
        M("Entries").find({}, "date total count deposit").sort({ createdAt: 1 }).lean(),
        M("Pawna").find({}, "name totalSend totalReceive transactions.date").lean(),
        M("Bank").find({}, "name totalDeposit totalWithdraw transactions").lean(),
        M("Cash").findOne({}).lean(),
        M("Gila").find({}, "name advance price entries").lean(),
    ]);

    const warnings = [];

    /* ---------- bKash ---------- */
    const bkash = people.map((p) => {
        const mine = txns.filter((t) => String(t.person) === String(p._id));
        const sent = mine.filter((t) => t.type === "send");
        const recv = mine.filter((t) => t.type === "receive");
        const dailyUsed = p.baseDayKey === tKey ? p.dailyUsedBase || 0 : 0;
        const monthlyUsed = p.baseMonthKey === mKey ? p.monthlyUsedBase || 0 : 0;
        const dailyRemaining = DAILY_LIMIT - dailyUsed;
        const monthlyRemaining = MONTHLY_LIMIT - monthlyUsed;
        const bundleDaysLeft = p.bundleExpiry ? Math.ceil((new Date(p.bundleExpiry) - now) / 86400000) : null;

        if (dailyRemaining <= 10000) warnings.push(`${p.name}: aajker limit e matro ${dailyRemaining} taka baki`);
        if (monthlyRemaining <= 30000) warnings.push(`${p.name}: ei masher limit e matro ${monthlyRemaining} taka baki`);
        if ((p.initialBalance || 0) < 1000) warnings.push(`${p.name}: balance kom (${p.initialBalance || 0} taka)`);
        if (p.bundleCount > 0 && bundleDaysLeft !== null && bundleDaysLeft <= 3) warnings.push(`${p.name}: bundle er ${p.bundleCount} ta baki, ${bundleDaysLeft} din por meyad shesh`);

        return {
            name: p.name, number: p.bkashNumber, balance: p.initialBalance || 0,
            dailyRemaining, monthlyRemaining, bundleLeft: p.bundleCount || 0, bundleDaysLeft,
            period: { sent: sum(sent, (t) => t.amount), sendCount: sent.length, received: sum(recv, (t) => t.amount), receiveCount: recv.length },
        };
    });
    const topCounterparties = Object.entries(
        txns.filter((t) => t.counterparty).reduce((m, t) => ((m[t.counterparty] = (m[t.counterparty] || 0) + t.amount), m), {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([who, amount]) => ({ who, amount }));

    /* ---------- Entry (Entry page er hisab hubohu) ---------- */
    const byDate = {};
    entries.forEach((e) => {
        const d = (byDate[e.date] ||= { total: 0, count: 0, deposit: 0 });
        d.total += e.total || 0; d.count += e.count || 0;
        if (e.deposit) d.deposit = Number(e.deposit) || 0; // page e ekdin er shesh joma-ta dhore
    });
    let carry = ENTRY_INITIAL_CARRY;
    Object.keys(byDate).sort().forEach((d) => { carry = carry + byDate[d].total - byDate[d].deposit; });
    const periodDays = Object.keys(byDate).filter((d) => d >= startKey).sort();
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        const k = dayKey(d);
        last7.push({ date: k, total: byDate[k]?.total || 0, deposit: byDate[k]?.deposit || 0 });
    }
    const entry = {
        hasanPawnaNow: carry,
        today: byDate[tKey] || { total: 0, count: 0, deposit: 0 },
        period: {
            total: sum(periodDays, (d) => byDate[d].total), count: sum(periodDays, (d) => byDate[d].count),
            deposit: sum(periodDays, (d) => byDate[d].deposit), days: periodDays.length,
        },
        last7Days: last7,
        last7Average: Math.round(sum(last7, (x) => x.total) / 7),
    };

    /* ---------- Pawna ---------- */
    const pawnaList = pawna.map((p) => {
        const net = (p.totalSend || 0) - (p.totalReceive || 0);
        const last = (p.transactions || []).reduce((m, t) => (new Date(t.date) > m ? new Date(t.date) : m), new Date(0));
        return { name: p.name, net, meaning: net > 0 ? "amake debe" : net < 0 ? "ami dibo" : "soman", lastActivity: last.getTime() ? dayKey(last) : null };
    }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    const pawnaSummary = {
        totalTheyOweMe: sum(pawnaList.filter((p) => p.net > 0), (p) => p.net),
        totalIOwe: -sum(pawnaList.filter((p) => p.net < 0), (p) => p.net),
        people: pawnaList,
    };

    /* ---------- Bank ---------- */
    const bank = banks.map((b) => {
        const t = b.transactions || [];
        const dep = typeof b.totalDeposit === "number" ? b.totalDeposit : sum(t.filter((x) => x.type !== "withdraw"), (x) => x.amount);
        const wd = typeof b.totalWithdraw === "number" ? b.totalWithdraw : sum(t.filter((x) => x.type === "withdraw"), (x) => x.amount);
        const pt = t.filter((x) => inPeriod(x.date, start));
        return {
            name: b.name, balance: dep - wd,
            period: { deposit: sum(pt.filter((x) => x.type === "deposit"), (x) => x.amount), withdraw: sum(pt.filter((x) => x.type === "withdraw"), (x) => x.amount) },
        };
    });

    /* ---------- Cash ---------- */
    const ct = ((cash && cash.transactions) || []).filter((x) => inPeriod(x.date, start));
    const cashInfo = {
        balance: cash ? cash.balance || 0 : 0,
        period: { given: sum(ct.filter((x) => x.type === "given"), (x) => x.amount), taken: sum(ct.filter((x) => x.type === "taken"), (x) => x.amount) },
    };

    /* ---------- Gila (Gila page er hisab hubohu) ---------- */
    const gilaList = gila.map((g) => {
        const es = g.entries || [];
        const pieces = sum(es, (e) => e.pieces);
        const target = g.price > 0 ? Math.ceil((g.advance || 0) / g.price) : 0;
        const lastDate = es.map((e) => e.date).sort().pop() || null;
        const daysSince = lastDate ? Math.floor((new Date(tKey) - new Date(lastDate)) / 86400000) : null;
        if (target - pieces > 0 && daysSince !== null && daysSince >= 3) warnings.push(`Gila ${g.name}: ${daysSince} din kono piece nai, ekhono ${target - pieces} piece baki`);
        return {
            name: g.name, advance: g.advance || 0, pricePerPiece: g.price || 0,
            piecesDone: pieces, piecesNeededForAdvance: target, piecesLeft: target - pieces,
            valueDone: pieces * (g.price || 0), advanceLeft: (g.advance || 0) - pieces * (g.price || 0),
            periodPieces: sum(es.filter((e) => e.date >= startKey), (e) => e.pieces), lastEntry: lastDate,
        };
    });

    return {
        period, from: startKey, today: tKey,
        bkash: {
            accounts: bkash,
            totalBalance: sum(bkash, (b) => b.balance),
            periodSent: sum(bkash, (b) => b.period.sent), periodReceived: sum(bkash, (b) => b.period.received),
            topCounterparties,
        },
        entry, pawna: pawnaSummary,
        bank: { banks: bank, totalBalance: sum(bank, (b) => b.balance) },
        cash: cashInfo,
        gila: { people: gilaList, totalAdvance: sum(gilaList, (g) => g.advance), totalAdvanceLeft: sum(gilaList, (g) => Math.max(0, g.advanceLeft)) },
        warnings,
        notes: "Shob jog-biyog kora ache. Ei shonkha gulo hubohu use koro; alada bhag (bkash, bank, cash, pawna, gila) eke onner sathe jog kore 'mot sompod' banaba na.",
    };
}

module.exports = { analyze };
