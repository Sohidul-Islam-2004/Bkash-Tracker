# AI সহকারী — chatbot (lekha + voice + photo)

Shob page er niche bame ✨ button. Chap dile chat khule.

## Ki ki pare
| Bolo / lekho | Ki hoy |
|---|---|
| "সালাম এর বিকাশ থেকে 5000 send, TrxID ABC123" | bKash transaction |
| "01711223344 5000, 01812345678 2000 entry koro" | Entry Manager e entry |
| "Rahim ke 2000 dhar dilam" / "Rahim 1000 ferot dilo" | Pawna |
| "DBBL e 10 hajar joma" | Bank deposit/withdraw |
| "Hasan ke 3000 cash dilam" | Cash given/taken |
| "Karim aaj aro 5 piece dilo" | Gila |
| "aajke shob hisab kemon?", "Salam er limit koto baki?" | Hisab dekhay |
| 📷 bKash screenshot / slip er chhobi | Chhobi pore TrxID, amount, number ber kore |
| 🎤 chap dao → bolo → ■ chap dao | Voice theke kaj |

**Kichui nijer theke save hoy na.** AI ekta card dekhay, tumi **Confirm** chaple tobe save hoy.
Save hoy tomar ager API route diye, tai bKash limit, balance, duplicate TrxID check ager motoi kaj kore.
Delete/edit AI diye hoy na, page theke korte hobe.

## Setup
1. `.env` e add koro:
   ```
   GROQ_API_KEY=gsk_...
   ```
   (Optional: `GROQ_MODEL`, `GROQ_VISION_MODEL`, `ENTRY_INITIAL_CARRY` — Entry page er InitialCarry bodlale etao bodlao)
2. `npm install` (notun package lage nai; multer agei package.json e ache)
3. Render e o `GROQ_API_KEY` environment variable e boshao.
4. Voice shudhu **https** (Render) ba `localhost` e kaj korbe.

## Notun / bodlano file
```
ai/groq.js                    # Groq: chat, Whisper (voice), vision (photo)
ai/tools.js                   # AI ki ki korte pare + Confirm system
ai/analysis.js                # pura hisab er analysis (shob jog-biyog server e)
ai/router.js                  # /api/ai/chat, /api/ai/confirm, /api/ai/cancel
public/assistant/assistant.js # chat widget
public/assistant/assistant.css
server.js                     # 1 line: app.use("/api/ai", ...)
*/index.html                  # protita page e widget er 2 line
```

## Mone rakho
- App e kono login nai, tai `/api/ai` o shobar jonno khola, jemon baki API. Link je pabe she Groq credit khoroch korte parbe.
- Nam list theke milay. Database e "সালাম" thakle "Salam" bolle-o AI bujhe nite pare, na parle jiggesh korbe.
- Chat history browser e thake (page bodlaleo), 🗑 diye muchha jay.
