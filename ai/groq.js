/* ============================================================
   GROQ — chat (tool calling), voice -> text, photo -> text
   Kono model na paile (404 / model_not_found) list er porer ta try kore.
   .env e GROQ_MODEL / GROQ_VISION_MODEL dile sheta shobar age try hobe.
   ============================================================ */
const BASE = "https://api.groq.com/openai/v1";

const uniq = (a) => [...new Set(a.filter(Boolean))];
const CHAT_MODELS = uniq([process.env.GROQ_MODEL, "openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b"]);
const VISION_MODELS = uniq([process.env.GROQ_VISION_MODEL, "qwen/qwen3.8-27b", "meta-llama/llama-4-scout-17b-16e-instruct"]);
const WHISPER_MODELS = uniq([process.env.GROQ_WHISPER_MODEL, "whisper-large-v3", "whisper-large-v3-turbo"]);

/* je model kaj kore seta mone rakhi, porer bar shorasori oita */
const working = {};

function key() {
    const k = process.env.GROQ_API_KEY;
    if (!k) throw new Error("GROQ_API_KEY .env e set kora nai");
    return k;
}

const isModelMissing = (status, text) =>
    status === 404 || /model_not_found|does not exist|decommissioned|not supported/i.test(text);

async function withFallback(kind, models, call) {
    const list = working[kind] ? uniq([working[kind], ...models]) : models;
    let lastErr;
    for (const model of list) {
        const res = await call(model);
        if (res.ok) { working[kind] = model; return res; }
        const text = await res.text();
        lastErr = new Error(`Groq ${kind} ${res.status} (${model}): ${text}`);
        if (!isModelMissing(res.status, text)) throw lastErr;
        console.warn(`[groq] ${model} pawa jay nai, porer model try korchi`);
        if (working[kind] === model) delete working[kind];
    }
    throw lastErr;
}

async function chat(messages, tools) {
    const res = await withFallback("chat", CHAT_MODELS, (model) =>
        fetch(`${BASE}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                temperature: 0.2,
                messages,
                ...(tools ? { tools, tool_choice: "auto" } : {}),
            }),
        })
    );
    const data = await res.json();
    const msg = data.choices[0].message;
    return { role: "assistant", content: msg.content || "", ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) };
}

async function transcribe(file) {
    const res = await withFallback("whisper", WHISPER_MODELS, (model) => {
        const form = new FormData();
        form.append("file", new Blob([file.buffer], { type: file.mimetype }), file.originalname || "voice.webm");
        form.append("model", model);
        form.append("language", "bn");
        form.append("temperature", "0");
        // NOTE: "prompt" deya hoy na — Whisper choto/nirob audio te prompt-tai hubohu ferot dey
        return fetch(`${BASE}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key()}` },
            body: form,
        });
    });
    return cleanTranscript((await res.json()).text || "");
}

/* Whisper nirob/choto audio te kichu baandha kotha "hallucinate" kore — oigula bad */
const JUNK = [/ধন্যবাদ\s*[।.!]?$/, /সাবস্ক্রাইব/, /subscribe/i, /thank you/i, /বিকাশ হিসাব।? ?Salam/, /ব্যাংকে জমা, ক্যাশ, পাওনা, গিলা/];
function cleanTranscript(t) {
    t = String(t || "").trim();
    if (t.replace(/[\s।.,!?-]/g, "").length < 2) return "";
    if (JUNK.some((re) => re.test(t)) && t.length < 40) return "";
    return t;
}

/* Photo theke shob lekha/number ber kore (bKash screenshot, slip, WhatsApp screenshot) */
async function readImage(file) {
    const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    const res = await withFallback("vision", VISION_MODELS, (model) =>
        fetch(`${BASE}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                temperature: 0,
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Ei chhobi ta bKash/bank/hisab er screenshot ba slip hote pare. " +
                                "Chhobir shob dorkari lekha hubohu likho: phone number, amount (taka), TrxID, tarikh, nam, Send/Receive/Cash Out/Deposit type. " +
                                "List akare likho, kono kichu banaba na. Porte na parle bolo 'porte parini'.",
                        },
                        { type: "image_url", image_url: { url: dataUrl } },
                    ],
                }],
            }),
        })
    );
    const data = await res.json();
    return (data.choices[0].message.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

module.exports = { chat, transcribe, readImage };
