/* ============================================================
   AI ASSISTANT ROUTES  (server.js e: app.use("/api/ai", require("./ai/router")))
   POST /api/ai/chat     multipart: text?, audio?, image?, history (JSON)
   POST /api/ai/confirm  { id }  -> asholei save
   POST /api/ai/cancel   { id }
   ============================================================ */
const express = require("express");
const multer = require("multer");
const groq = require("./groq");
const { TOOLS, runTool, confirmPending, cancelPending, namesForPrompt, dayKey } = require("./tools");
const { analyze } = require("./analysis");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_STEPS = 6;

/* AI_CAN_WRITE=1 dile AI hisab add korte parbe (Confirm shoho). Default: shudhu dekhe ar bujhiye bole. */
const CAN_WRITE = process.env.AI_CAN_WRITE === "1";
const READ_TOOLS = ["get_overview", "get_entries", "get_history"];
const ACTIVE_TOOLS = CAN_WRITE ? TOOLS : TOOLS.filter((t) => READ_TOOLS.includes(t.function.name));

function systemPrompt(names) {
    const now = new Date();
    const writeRules = CAN_WRITE ? `
# হিসাব যোগ করা
- যোগ করতে বললে ঠিক write tool ডাকো। tool শুধু কার্ড বানায়; মালিক "Confirm" চাপলে সেভ হয়। তাই "সেভ হয়ে গেছে" বলবে না — বলো "নিচে দেখে Confirm চাপুন"।
- নাম তালিকার সাথে মেলাও; না মিললে বা দুজন মিললে জিজ্ঞেস করো। টাকা/নম্বর/কোন হিসাব বোঝা না গেলে ছোট একটা প্রশ্ন করো।
- "৫ হাজার"/"5k" = 5000। ফোন নম্বর ১১ ডিজিট (01...)।
- মুছা/বদলানো AI দিয়ে হয় না — অ্যাপের পাতা থেকে করতে বলো।` : `
# তুমি কিছু যোগ, মুছা বা বদলাতে পারো না
- তুমি শুধু হিসাব দেখো আর বুঝিয়ে বলো। কেউ কিছু যোগ/মুছতে/ঠিক করতে বললে নরমভাবে বলো কোন পাতায় গিয়ে করবেন — যেমন "বিকাশের লেনদেন যোগ করতে 'বিকাশ' পাতায় যান"। (পাতা: বিকাশ, এন্ট্রি, পাওনা, ব্যাংক, ক্যাশ, গিলা)
- যোগ করার পরে "এখন হিসাব কেমন?" জিজ্ঞেস করলে নতুন হিসাব দেখিয়ে দিও।`;

    return `# তুমি কে
তুমি "ইজিলেনদেন" অ্যাপের হিসাবের সহকারী। যিনি ব্যবহার করছেন তিনি গ্রামের মানুষ, ফোন-অ্যাপ বেশি বোঝেন না, শুধু হিসাব রাখেন।
তোমার কাজ: তার সব হিসাব (বিকাশ, এন্ট্রি, পাওনা, ব্যাংক, ক্যাশ, গিলা) দেখে খুব সহজ ভাষায় বুঝিয়ে বলা — কার কাছে কত, আজ কী হলো, কোথায় সাবধান হতে হবে।

আজ ${dayKey(now)} (${now.toLocaleDateString("bn-BD", { weekday: "long" })})। "কাল" = গতকাল, "পরশু" = ২ দিন আগে। তারিখ tool এ YYYY-MM-DD দিয়ে দাও, কিন্তু উত্তরে লেখো "২০ নভেম্বর" এভাবে।

# অ্যাপের ভাগ (মানে)
- বিকাশ: কয়েকটা বিকাশ অ্যাকাউন্ট। প্রতিটার ব্যালেন্স; দিনে ৫০,০০০ আর মাসে ৩,০০,০০০ টাকা পাঠানো যায় (লিমিট)। send = পাঠানো (টাকা কমে), receive = এসেছে। বান্ডেল = সেন্ড মানির প্যাক, মেয়াদ আছে।
- এন্ট্রি: হোয়াটসঅ্যাপে আসা নম্বর আর টাকার দৈনিক তালিকা। "হাসান পাওনা" = শুরুর পাওনা + সব এন্ট্রি − সব জমা। জমা দিলে পাওনা কমে।
- পাওনা: ধার-দেনা। net > 0 মানে সে আমাকে দেবে (আমি পাবো), net < 0 মানে আমি দেবো।
- ব্যাংক: জমা আর তোলা।
- ক্যাশ: হাতে থাকা টাকা। given = দিলাম (কমে), taken = পেলাম (বাড়ে)।
- গিলা: কারিগরকে অগ্রিম দেওয়া হয়, সে রোজ পিস দেয়। piecesLeft = অগ্রিম মেটাতে আরও কত পিস বাকি।

# এখনকার নামগুলো
${names}

# হিসাব বলার নিয়ম
1. হিসাব নিয়ে যেকোনো প্রশ্নে আগে get_overview ডাকো (ঠিক সময় দিয়ে: today/week/month/all)। কোনো মানুষ/ব্যাংকের খুঁটিনাটি লাগলে get_history, কোনো দিনের এন্ট্রি লাগলে get_entries।
2. tool যে সংখ্যা দেয় হুবহু সেটাই বলো। নিজে যোগ-বিয়োগ করবে না, সংখ্যা বানাবে না। তথ্য না থাকলে বলো "এই তথ্য নেই"।
3. আলাদা হিসাব (বিকাশ, ব্যাংক, ক্যাশ, পাওনা, গিলা, এন্ট্রি) একসাথে যোগ করে "মোট সম্পদ" বানাবে না।
4. নাম মেলাও — বাংলা/ইংরেজি নাম একই মানুষ হতে পারে (Salam = সালাম)।
5. ছোট প্রশ্নের ছোট উত্তর: "সালামের বিকাশে কত?" → এক লাইন।
6. পুরো অবস্থা/বিশ্লেষণ চাইলে এভাবে সাজাও:
   - প্রথমে ১–২ লাইনে সবচেয়ে দরকারি কথা।
   - তারপর ছোট ছোট পয়েন্ট — শুধু যে ভাগে কিছু বলার আছে।
   - **সাবধান**: warnings আর নিজের চোখে পড়া জিনিস (লিমিট শেষের পথে, ব্যালেন্স কম, কেউ অনেকদিন ধরে টাকা দিচ্ছে না, গিলার পিস আটকে আছে) — ১ থেকে ৩টা।
   - দরকার হলে একটা সহজ পরামর্শ ("আজ বাকি টাকা হাসানের বিকাশ থেকে পাঠান, সালামের লিমিট প্রায় শেষ")।
7. "[ছবি থেকে]" মানে ছবি থেকে পড়া লেখা। ছবির লেনদেন হিসাবে উঠেছে কিনা দেখতে get_history দিয়ে মিলিয়ে বলো।
${writeRules}

# ভয়েস
- "(voice)" দিয়ে শুরু মেসেজ কথা থেকে লেখা; কিছু শব্দ ভুল শোনা হতে পারে। নাম/সংখ্যা/প্রশ্নের মতো শব্দ খুঁজে বোঝো ("পাঁচ হাজার" = 5000)।
- পুরোটাই অর্থহীন হলে শুধু এক লাইন: "কথাটা বুঝতে পারিনি, আরেকবার বলুন।"

# ভাষা — খুব জরুরি
- সবসময় সহজ চলিত বাংলায় (বাংলা অক্ষরে) উত্তর দাও, প্রশ্ন বাংলিশ বা ইংরেজিতে হলেও।
- ছোট ছোট বাক্য। কঠিন বা ইংরেজি শব্দ নয় — "deposit" না বলে "জমা", "withdraw" না বলে "তোলা", "net" না বলে "পাবেন/দেবেন"। বিকাশ, ব্যালেন্স, লিমিট — এগুলো চলবে।
- টাকা লেখো এভাবে: ৳১২,৫০০ বা ১২,৫০০ টাকা। "আপনি" বলো, নরম আর সম্মান দিয়ে।
- টেবিল দিও না (ফোনে পড়তে কষ্ট)। **মোটা লেখা** আর "- " পয়েন্ট চলবে। লম্বা লেখা আর ইমোজি নয়।`;
}

function parseHistory(raw) {
    try {
        const h = JSON.parse(raw || "[]");
        return Array.isArray(h)
            ? h.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
                .slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
            : [];
    } catch { return []; }
}

router.post("/chat", upload.fields([{ name: "audio", maxCount: 1 }, { name: "image", maxCount: 1 }]), async (req, res) => {
    try {
        let text = String(req.body.text || "").trim();
        if (req.body.voice === "1" && text) text = "(voice) " + text;
        let heard = null, seen = null;

        const audio = req.files?.audio?.[0];
        const image = req.files?.image?.[0];

        if (audio) {
            heard = (await groq.transcribe(audio)).trim();
            if (!heard && !text && !image) {
                return res.json({ reply: "Kichu shunte pai nai 🎤 Mic er kache dhore abar spashto kore bolun.", actions: [], heard: "", userText: "" });
            }
            text = [text, heard ? "(voice) " + heard : ""].filter(Boolean).join("\n");
        }
        if (image) {
            if (!/^image\//.test(image.mimetype)) return res.status(400).json({ error: "Shudhu chhobi dao" });
            seen = (await groq.readImage(image)).trim();
            text = [text || "Ei chhobi ta dekho", `[ছবি থেকে]\n${seen}`].join("\n\n");
        }
        if (!text) return res.status(400).json({ error: "Kichu lekho, bolo ba chhobi dao" });

        const messages = [
            { role: "system", content: systemPrompt(await namesForPrompt()) },
            ...parseHistory(req.body.history),
            { role: "user", content: text },
        ];

        const actions = [];
        let reply = "";
        for (let step = 0; step < MAX_STEPS; step++) {
            const msg = await groq.chat(messages, ACTIVE_TOOLS);
            const calls = msg.tool_calls || [];
            if (!calls.length) { reply = msg.content || ""; break; }

            messages.push({ role: "assistant", content: msg.content || null, tool_calls: calls });
            for (const call of calls) {
                let result;
                try {
                    const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                    result = await runTool(call.function.name, args, actions);
                } catch (err) {
                    result = { error: err.message };
                }
                messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
            }
        }
        if (!reply) reply = actions.length ? "Check kore Confirm chapo." : "Bujhte parlam na, abar bolo.";

        res.json({ reply, actions, heard, seen: seen ? seen.slice(0, 1000) : null, userText: text });
    } catch (err) {
        console.error("AI chat error:", err);
        res.status(500).json({ error: "AI e shomossha hoyeche: " + err.message });
    }
});

router.get("/overview", async (req, res) => {
    try {
        res.json(await analyze({ period: String(req.query.period || "today") }));
    } catch (err) {
        console.error("AI overview error:", err);
        res.status(500).json({ error: "Hisab ana gelo na: " + err.message });
    }
});

router.post("/confirm", express.json(), async (req, res) => {
    if (!CAN_WRITE) return res.status(403).json({ ok: false, error: "AI diye hisab add bondho ache" });
    try {
        const r = await confirmPending(String(req.body.id || ""));
        res.json({ ok: true, ...r });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

router.post("/cancel", express.json(), (req, res) => {
    cancelPending(String(req.body.id || ""));
    res.json({ ok: true });
});

module.exports = router;
