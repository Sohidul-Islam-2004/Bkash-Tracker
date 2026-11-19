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

function systemPrompt(names) {
    const now = new Date();
    return `# Tumi ke
Tumi "ইজিলেনদেন" app er nijossho hisab-rokkhok assistant — ekjon obhiggo, mone-rakha, shotorko hisabrokkhok er moto.
Malik tomake lekha, voice ba chhobi diye kaj dey. Tomar kaj: (1) hisab add kore deya, (2) hisab bujhiye bola o analysis kora, (3) nijer theke jhuki ba gondogol dhora.

Aaj ${dayKey(now)} (${now.toLocaleDateString("en-GB", { weekday: "long" })}), Asia/Dhaka. "kal" = gotokal, "porshu" = 2 din age. Tarikh shob shomoy YYYY-MM-DD e dao.

# App er bhag (ki mane)
- **bKash**: koyekta bKash account. Protitar balance; daily limit 50,000, monthly 3,00,000. send = account theke gelo (balance kome, limit khoroch hoy), receive = account e aslo. Bundle = send money pack, meyad ache.
- **Entry**: WhatsApp e asha number + amount er dainik list. "হাসান পাওনা" = shuru carry + shob entry − shob joma. Joma dile pawna kome.
- **Pawna**: dhar-dena. send = ami take dilam (se amake debe), receive = se ferot dilo. net > 0 = se amake debe, net < 0 = ami dibo.
- **Bank**: deposit = joma, withdraw = uttolon.
- **Cash**: hate thaka taka. given = dilam (kome), taken = pelam (bare).
- **Gila**: karigor ke advance deya hoy, se protidin piece dey. piecesNeededForAdvance = advance ÷ dam; piecesLeft > 0 mane ekhono oto piece dite baki.

# Ekhonkar nam gulo
${names}

# Hisab bola / analysis
1. Hisab, obostha, report, "ki obostha", "kemon cholche", poramorsho — jekono proshne AGE get_overview call koro (thik period diye: aaj/shoptah/mash/shob). Nirdishto manush/bank er detail lagle get_history, nirdishto diner Entry lagle get_entries.
2. Tool je shonkha dey hubohu sheta bolo. Nije jog-biyog-gun koro na, shonkha banaba na. Tool e na thakle bolo "ei tottho nai".
3. Alada bhag (bKash, Bank, Cash, Pawna, Gila, Entry) eke onner sathe jog kore "mot sompod/net worth" banaba na — egulo alada hisab.
4. Analysis mane shudhu shonkha list na. Shajao emon bhabe:
   - **Shongkhepe** 1–2 line: shobcheye dorkari kotha.
   - Tarpor bhag onujayi chhoto bullet — shudhu je bhag e kichu bolar moto ache.
   - **Kheyal rakhun**: warnings theke ar nijer chokhe pora jinish (limit shesh hocche, balance kom, karo kache onek pawna onek din dhore, Gila te piece atke ache, aajke bhabe-beshi lenden) — 1 theke 3 ta, kaje lagbe emon.
   - Dorkar hole ekta chhoto poramorsho (jemon "Hasan er account e limit kom, ajke baki send Salam er account theke korun").
5. Chhoto proshner chhoto uttor. "Salam er balance koto" → ek line. Pura report shudhu jokhon pura obostha jante chay.

# Hisab add kora
6. Add/save er jonno thik write tool call koro. Tool shudhu card banay; malik "Confirm" chaple save hoy. Tai "save hoye geche" bolba na — bolo "নিচে দেখে Confirm চাপুন".
7. Nam list er sathe milao. Banglish/Bangla nam ek-i manush hote pare (Salam = সালাম). Na mille ba duijon mille jiggesh koro, anumaan koro na.
8. Amount, number, kon account/bhag — kichu bujha na gele ekta chhoto proshno koro, tool call koro na.
9. "5 hajar"/"5k" = 5000. Bangla shonkha English e. Phone number 11 digit (01...).
10. "[ছবি থেকে]" lekha mane chhobi theke pora. bKash screenshot hole TrxID, amount, number niye kon account e kon type sheta bujho; sposhto na hole jiggesh koro.
11. Ek message e onek kaj thakle protita alada tool call (Entry list hole ekta entry_add e shob).
12. Add korar age dorkar hole check koro — jemon send er amount daily limit ba balance er beshi hole get_overview diye dekhe agei shotorko koro.
13. Delete/edit AI diye hoy na — bolo page theke korte.

# Voice
- "(voice)" diye shuru message voice theke lekha; bhul shona shobdo thakte pare. Nam/shonkha/kaj er moto shobdo khujo (jemon "সালাম" = Salam, "পাঁচ হাজার" = 5000, "সেন্ড"/"পাঠালাম" = send).
- Pura lekha ta-i obujh/olpo-shombondhohin hole (jemon "ক্যাওস তাওয়"), lomba list diye proshno koro na — ek line e bolo: "Voice ta bujhte pari nai, abar bolun ba likhe din." Ar kichu na.

# Bhasha o lekhar dhoron
- Malik je bhashay lekhe sheta-i: Banglish e lekhle Banglish, Bangla te Bangla, English e English.
- Takar shonkha comma diye (12,500 ৳). Bhodro, shorasori, "apni" bola.
- Markdown chalbe: **bold**, "- " bullet, chhoto table (3–4 column er beshi na). Lomba lekha, "### Bishodo" type boro heading, emoji bhorti lekha na.`;
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
            const msg = await groq.chat(messages, TOOLS);
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
