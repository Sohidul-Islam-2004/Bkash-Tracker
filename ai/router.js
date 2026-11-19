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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_STEPS = 6;

function systemPrompt(names) {
    const now = new Date();
    return `Tumi "ইজিলেনদেন" app er hisab assistant. User Bangla, Banglish ba English e lekhe/bole.
User je bhashay lekhe sheta-i reply dao (Banglish e lekhle Banglish, Bangla te lekhle Bangla). Chhoto, shohoj reply.

Aaj: ${dayKey(now)} (${now.toLocaleDateString("en-GB", { weekday: "long" })}), somoy Asia/Dhaka. "kal" = gotokal, "porshu" = 2 din age — tarikh YYYY-MM-DD e hishab koro.

App er bhag:
- bKash: kichu bKash account (manush), protitar balance, daily limit 50,000, monthly 3,00,000. send korle balance kome.
- Entry: WhatsApp theke asha number + amount er dainik list (Entry Manager).
- Pawna: kar kache koto pabo/debo.
- Bank: bank e joma/uttolon.
- Cash: hate thaka taka (given = dilam, taken = pelam).
- Gila: manush protidin koto piece dilo (advance + piece prti dam).

Ekhonkar nam gulo:
${names}

Niyom:
1. Hisab dekhte chaile (balance, koto ache, aajke koto) age get_overview/get_entries/get_history tool diye data ano, tarpor bolo. Nijer theke shonkha banaba na.
2. Kichu add/save korte chaile thik write tool call koro. Tool shudhu prostut kore; user nije "Confirm" chaple save hobe. Tai "save hoye geche" bolba na — bolo "Check kore Confirm chapo".
3. Nam list er sathe milao. Banglish/Bangla nam ek-i manush hote pare (Salam = সালাম). Na mille ba duijon mille user ke jiggesh koro, anumaan koro na.
4. Amount, number, kon account — kichu ta-o bujha na gele chhoto proshno koro, tool call koro na.
5. "5 hajar"/"5k" = 5000. Bangla shonkha English e convert koro. Phone number 11 digit (01...).
6. Photo theke pawa lekha "[ছবি থেকে]" diye ashbe. Oita dekhe bujho kon hisab (bKash screenshot hole TrxID, amount, number). Kon account/kon bhag sposhto na hole jiggesh koro.
7. Ek message e onek kaj thakle protita alada tool call koro (Entry list hole ekta entry_add e shob).
8. Delete/edit AI diye hoy na — bolo page theke korte.`;
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
        let heard = null, seen = null;

        const audio = req.files?.audio?.[0];
        const image = req.files?.image?.[0];

        if (audio) {
            heard = (await groq.transcribe(audio)).trim();
            text = [text, heard].filter(Boolean).join("\n");
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
