/* ============================================================
   AI সহকারী — shob page e floating chat
   lekha, voice (🎤 chap dao, abar chap dile pathabe), photo (📷)
   Save er age protita kaj "Confirm" korte hoy
   ============================================================ */
(function () {
    if (window.__aiAssistant) return;
    window.__aiAssistant = true;

    const API = "/api/ai";
    const STORE = "ai_chat_v1";
    const MODULE_PAGE = { bkash: "/Bkash", entry: "/Entry", pawna: "/Pawna", bank: "/Bank", cash: "/Cash", gila: "/Gila" };

    /* ---------- state (page bodlaleo chat thake) ---------- */
    let msgs = [];
    try { msgs = JSON.parse(localStorage.getItem(STORE) || "[]"); if (!Array.isArray(msgs)) msgs = []; } catch { msgs = []; }
    const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch { } };

    let busy = false;
    let imageFile = null;
    let rec = null, recChunks = [], recTimer = null, recStart = 0;
    let tab = "hisab";
    try { tab = localStorage.getItem("ai_tab") || "hisab"; } catch { }
    let period = "today", dash = null, dashLoading = false, dashErr = null;

    /* ---------- DOM ---------- */
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");

    /* chhoto markdown renderer: heading, bold, bullet, numbered list, table */
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
    function md(src) {
        const lines = esc(src).replace(/\r/g, "").split("\n");
        const out = [];
        let para = [];
        const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (/^\s*\|/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
                flush();
                const head = cells(l);
                const rows = [];
                i += 2;
                while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
                i--;
                out.push(`<div class="ai-tbl"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
            } else if (/^\s*#{1,6}\s+/.test(l)) {
                flush(); out.push(`<div class="ai-h">${inline(l.replace(/^\s*#{1,6}\s+/, ""))}</div>`);
            } else if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
                flush();
                const ordered = /^\s*\d+[.)]/.test(l);
                const items = [];
                while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, "")));
                i--;
                out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${x}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
            } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
                flush(); out.push("<hr>");
            } else if (!l.trim()) {
                flush();
            } else {
                para.push(l);
            }
        }
        flush();
        return out.join("");
    }

    const ICON = {
        spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7L5 15z"/></svg>',
        x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
        stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
        cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
        send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg>',
        refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
        warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2zM12 10v5M12 18v.5"/></svg>',
        speak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/></svg>',
        trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    };

    const fab = document.createElement("button");
    fab.className = "ai-fab";
    fab.type = "button";
    fab.title = "AI সহকারী";
    fab.innerHTML = ICON.spark + "<span>হিসাব</span>";

    const panel = document.createElement("div");
    panel.className = "ai-panel";
    panel.innerHTML = `
      <div class="ai-head">
        <div class="ai-title"><span class="ai-dot">${ICON.spark}</span><div><b>AI সহকারী</b><small>হিসাব দেখুন, প্রশ্ন করুন</small></div></div>
        <button class="ai-ibtn" data-act="clear" title="চ্যাট মুছুন">${ICON.trash}</button>
        <button class="ai-ibtn" data-act="close" title="বন্ধ">${ICON.x}</button>
      </div>
      <div class="ai-tabs"><button type="button" data-tab="hisab">হিসাব</button><button type="button" data-tab="chat">চ্যাট</button></div>
      <div class="ai-dash"></div>
      <div class="ai-body"></div>
      <div class="ai-img-chip" hidden><img alt=""><span>ছবি যুক্ত হয়েছে</span><button type="button" title="বাদ">${ICON.x}</button></div>
      <div class="ai-rec" hidden><span class="ai-rec-dot"></span><span class="ai-rec-time">0:00</span> শুনছি… শেষ হলে ■ চাপুন</div>
      <div class="ai-quick"></div>
      <form class="ai-input">
        <button type="button" class="ai-ibtn" data-act="photo" title="ছবি">${ICON.cam}</button>
        <input type="file" accept="image/*" hidden>
        <textarea rows="1" placeholder="প্রশ্ন লিখুন বা 🎤 চেপে বলুন"></textarea>
        <button type="button" class="ai-ibtn ai-mic" data-act="mic" title="ভয়েস">${ICON.mic}</button>
        <button type="submit" class="ai-send" title="পাঠান">${ICON.send}</button>
      </form>`;

    document.body.append(fab, panel);

    const $ = (s) => panel.querySelector(s);
    const body = $(".ai-body");
    const ta = $("textarea");
    const fileIn = $('input[type="file"]');
    const chip = $(".ai-img-chip");
    const micBtn = $(".ai-mic");

    /* ---------- open / close ---------- */
    const dashEl = $(".ai-dash");
    function setTab(t) {
        tab = t;
        try { localStorage.setItem("ai_tab", t); } catch { }
        panel.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
        dashEl.hidden = t !== "hisab";
        body.hidden = t !== "chat";
        $(".ai-quick").hidden = t !== "chat";
        $('[data-act="clear"]').style.visibility = t === "chat" ? "visible" : "hidden";
        if (t === "hisab") { if (!dash && !dashLoading) loadDash(); else renderDash(); } else render();
    }
    panel.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

    const open = () => { panel.classList.add("open"); fab.classList.add("hide"); dash = null; setTab(tab); };
    const close = () => { panel.classList.remove("open"); fab.classList.remove("hide"); stopRec(true); stopSR(false); };
    fab.onclick = open;
    $('[data-act="close"]').onclick = close;
    $('[data-act="clear"]').onclick = () => { msgs = []; persist(); render(); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel.classList.contains("open")) close(); });

    /* ---------- render ---------- */
    function render() {
        if (!msgs.length) {
            body.innerHTML = `
              <div class="ai-empty">
                <div class="ai-empty-ic">${ICON.spark}</div>
                <b>হিসাব নিয়ে যা খুশি জিজ্ঞেস করুন</b>
                <p>নিচের একটা চাপুন, লিখুন, অথবা 🎤 চেপে মুখে বলুন।</p>
                ${["আজকের সব হিসাব কেমন?", "কার কাছে কত টাকা পাবো?", "হাসান এখন কত পাবে?", "এই মাসে বিকাশে কত টাকা গেলো?"]
                    .map((s) => `<button type="button" class="ai-sug">${esc(s)}</button>`).join("")}
              </div>`;
            body.querySelectorAll(".ai-sug").forEach((b) => (b.onclick = () => { ta.value = b.textContent; send(); }));
            return;
        }
        body.innerHTML = msgs.map((m, i) => {
            if (m.hidden) return "";
            if (m.role === "user") {
                return `<div class="ai-row me"><div class="ai-bub">${m.img ? `<span class="ai-tag">📷 ছবি</span>` : ""}${m.voice ? `<span class="ai-tag">🎤</span>` : ""}${fmt(m.show)}</div></div>`;
            }
            if (m.role === "error") return `<div class="ai-row"><div class="ai-bub err">${fmt(m.show)}</div></div>`;
            const cards = (m.actions || []).map((a, j) => card(a, i, j)).join("");
            const pend = (m.actions || []).filter((a) => a.state === "pending").length;
            return `<div class="ai-row"><div class="ai-bub ai-md">${md(m.show)}${canSpeak && m.show ? `<button type="button" class="ai-say" data-say="${i}" title="শুনুন">${ICON.speak}<span>শুনুন</span></button>` : ""}</div></div>${cards}
                ${pend > 1 ? `<div class="ai-all"><button type="button" data-all="${i}">✓ সব Confirm (${pend})</button></div>` : ""}`;
        }).join("") + (busy ? `<div class="ai-row"><div class="ai-bub ai-typing"><i></i><i></i><i></i></div></div>` : "");

        body.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => confirmAction(...b.dataset.ok.split(":").map(Number))));
        body.querySelectorAll("[data-no]").forEach((b) => (b.onclick = () => cancelAction(...b.dataset.no.split(":").map(Number))));
        body.querySelectorAll("[data-all]").forEach((b) => (b.onclick = () => confirmAll(Number(b.dataset.all))));
        body.querySelectorAll("[data-refresh]").forEach((b) => (b.onclick = () => location.reload()));
        body.querySelectorAll("[data-say]").forEach((b) => (b.onclick = () => speak(msgs[Number(b.dataset.say)].show, b)));
        body.scrollTop = body.scrollHeight;
    }

    function card(a, i, j) {
        const onPage = MODULE_PAGE[a.module] && location.pathname.toLowerCase().startsWith(MODULE_PAGE[a.module].toLowerCase());
        let foot = "";
        if (a.state === "pending") foot = `<button type="button" class="ok" data-ok="${i}:${j}">✓ Confirm</button><button type="button" class="no" data-no="${i}:${j}">বাদ দিন</button>`;
        else if (a.state === "saving") foot = `<span class="st">সেভ হচ্ছে…</span>`;
        else if (a.state === "done") foot = `<span class="st good">✓ সেভ হয়েছে</span>${onPage ? `<button type="button" class="ref" data-refresh>পেজ রিফ্রেশ</button>` : ""}`;
        else if (a.state === "cancelled") foot = `<span class="st">বাদ দেওয়া হয়েছে</span>`;
        else if (a.state === "failed") foot = `<span class="st bad">✕ ${esc(a.error || "হয়নি")}</span>`;
        return `<div class="ai-card ${a.state}"><div class="ai-card-txt">${fmt(a.summary)}</div><div class="ai-card-foot">${foot}</div></div>`;
    }

    /* ---------- dhrut proshno (chap dilei jiggesh) ---------- */
    const QUICK = ["আজকের হিসাব", "কে কত পাবে?", "হাসান কত পাবে?", "বিকাশের লিমিট", "এই সপ্তাহের হিসাব", "গিলার হিসাব"];
    $(".ai-quick").innerHTML = QUICK.map((q) => `<button type="button">${q}</button>`).join("");
    $(".ai-quick").querySelectorAll("button").forEach((b) => (b.onclick = () => { ta.value = b.textContent; send(); }));

    /* ---------- uttor pore shonano (Bangla TTS) ---------- */
    const canSpeak = "speechSynthesis" in window;
    let speakingBtn = null;
    function speak(text, btn) {
        if (!canSpeak) return;
        if (speakingBtn === btn) { speechSynthesis.cancel(); btn.classList.remove("on"); speakingBtn = null; return; }
        speechSynthesis.cancel();
        if (speakingBtn) speakingBtn.classList.remove("on");
        const clean = String(text || "").replace(/\*\*|`|#+\s|^\s*[-*•]\s/gm, "").replace(/\|/g, " ").replace(/([\d০-৯]),(?=[\d০-৯])/g, "$1").replace(/৳\s?([\d০-৯]+)/g, "$1 টাকা");
        const u = new SpeechSynthesisUtterance(clean);
        u.lang = "bn-BD";
        const v = speechSynthesis.getVoices().find((x) => /^bn/i.test(x.lang));
        if (v) u.voice = v;
        u.rate = 0.95;
        u.onend = u.onerror = () => { btn.classList.remove("on"); if (speakingBtn === btn) speakingBtn = null; };
        btn.classList.add("on"); speakingBtn = btn;
        speechSynthesis.speak(u);
    }
    if (canSpeak) speechSynthesis.getVoices();

    /* ---------- send ---------- */
    function history() {
        return msgs.filter((m) => m.role === "user" || m.role === "assistant").slice(-12).map((m) => ({ role: m.role, content: m.ctx || m.show || "" }));
    }

    async function send(audioBlob, viaVoice) {
        if (busy) return;
        if (tab !== "chat") setTab("chat");
        const text = ta.value.trim();
        if (!text && !audioBlob && !imageFile) return;

        const fd = new FormData();
        fd.append("history", JSON.stringify(history()));
        if (text) fd.append("text", text);
        if (viaVoice) fd.append("voice", "1");
        if (audioBlob) fd.append("audio", audioBlob, "voice." + (audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm"));
        if (imageFile) fd.append("image", imageFile, imageFile.name || "photo.jpg");

        const userMsg = { role: "user", show: text || (audioBlob ? "…" : ""), img: !!imageFile, voice: !!audioBlob || !!viaVoice };
        msgs.push(userMsg);
        ta.value = ""; autosize(); clearImage();
        busy = true; render();

        try {
            const res = await fetch(API + "/chat", { method: "POST", body: fd });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || "সার্ভার সমস্যা");
            if (d.heard) userMsg.show = [text, d.heard].filter(Boolean).join("\n");
            userMsg.ctx = d.userText || userMsg.show;
            msgs.push({ role: "assistant", show: d.reply, actions: (d.actions || []).map((a) => ({ ...a, state: "pending" })) });
        } catch (e) {
            msgs.push({ role: "error", show: "⚠ " + e.message });
        } finally {
            busy = false; persist(); render();
        }
    }

    $(".ai-input").onsubmit = (e) => { e.preventDefault(); send(); };
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); send(); } });
    const autosize = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; };
    ta.addEventListener("input", autosize);

    /* ---------- confirm / cancel ---------- */
    async function confirmAction(i, j) {
        const a = msgs[i] && msgs[i].actions && msgs[i].actions[j];
        if (!a || a.state !== "pending") return;
        a.state = "saving"; render();
        try {
            const res = await fetch(API + "/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok || !d.ok) throw new Error(d.error || "সেভ হয়নি");
            a.state = "done";
            dash = null;
            msgs.push({ role: "assistant", show: "", ctx: "Saved: " + a.summary, hidden: true });
            window.dispatchEvent(new CustomEvent("ai:saved", { detail: { module: a.module } }));
        } catch (e) {
            a.state = "failed"; a.error = e.message;
        }
        persist(); render();
    }
    async function confirmAll(i) {
        const list = (msgs[i].actions || []).map((a, j) => [a, j]).filter(([a]) => a.state === "pending");
        for (const [, j] of list) await confirmAction(i, j);
    }
    function cancelAction(i, j) {
        const a = msgs[i].actions[j];
        a.state = "cancelled";
        fetch(API + "/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) }).catch(() => { });
        persist(); render();
    }

    /* ---------- photo ---------- */
    $('[data-act="photo"]').onclick = () => fileIn.click();
    fileIn.onchange = () => {
        const f = fileIn.files[0];
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) { alert("ছবি ১০MB এর কম হতে হবে"); fileIn.value = ""; return; }
        imageFile = f;
        chip.querySelector("img").src = URL.createObjectURL(f);
        chip.hidden = false;
        ta.focus();
    };
    function clearImage() {
        imageFile = null; fileIn.value = ""; chip.hidden = true;
        const img = chip.querySelector("img");
        if (img.src) URL.revokeObjectURL(img.src);
        img.removeAttribute("src");
    }
    chip.querySelector("button").onclick = clearImage;

    /* ---------- voice (tap = shuru, abar tap = pathao) ---------- */
    /* Chrome/Android e browser er nijer Bangla voice (bn-BD) — onek bhalo bojhe, kotha bolar shathe shathe lekha dekhay.
       Na thakle (Messenger/Facebook browser, Firefox) server er Whisper. */
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let sr = null, srBase = "", useWhisper = false;
    try { useWhisper = localStorage.getItem("ai_whisper") === "1"; } catch { }

    micBtn.onclick = () => {
        if (sr) return stopSR(true);
        if (rec) return stopRec(false);
        if (!window.isSecureContext) return startRec(); // startRec e https er message ache
        if (SR && !useWhisper) startSR(); else startRec();
    };

    function recUI(on) {
        clearInterval(recTimer);
        micBtn.classList.toggle("on", on);
        micBtn.innerHTML = on ? ICON.stop : ICON.mic;
        $(".ai-rec").hidden = !on;
        $(".ai-rec-time").textContent = "0:00";
        if (on) {
            recStart = Date.now();
            recTimer = setInterval(() => {
                const s = Math.floor((Date.now() - recStart) / 1000);
                $(".ai-rec-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
                if (s >= 120) { stopSR(true); stopRec(false); }
            }, 250);
        }
    }

    function startSR() {
        if (busy) return;
        if (tab !== "chat") setTab("chat");
        const r = new SR();
        r.lang = "bn-BD";
        r.continuous = true;
        r.interimResults = true;
        srBase = ta.value.trim();
        let finalText = "";
        r.onresult = (e) => {
            let interim = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
                else interim += e.results[i][0].transcript;
            }
            ta.value = [srBase, (finalText + interim).trim()].filter(Boolean).join(" ");
            autosize();
        };
        r.onerror = (e) => {
            if (sr !== r) return;
            sr = null; recUI(false);
            if (e.error === "aborted") return;
            if (e.error === "not-allowed" || e.error === "service-not-allowed") {
                return voiceError("Mic er permission bondho. Address bar er bame 🔒 icon e chap diye Microphone → Allow koro, tarpor page reload dao.");
            }
            if (e.error === "no-speech") return voiceError("Kichu shunte pai nai. 🎤 chap diye shathe shathe bolun.");
            useWhisper = true;
            try { localStorage.setItem("ai_whisper", "1"); } catch { }
            voiceError(`Browser er voice kaj korche na (${e.error}). Ekhon theke server er voice use hobe — abar 🎤 chapun.`);
        };
        r.onend = () => {
            if (sr !== r) return;
            const shouldSend = r._send !== false;
            sr = null; recUI(false);
            const said = ta.value.trim();
            if (shouldSend && said && said !== srBase) send(undefined, true);
        };
        sr = r;
        try { r.start(); recUI(true); } catch (err) { sr = null; recUI(false); voiceError("Voice shuru hoy nai: " + err.message); }
    }
    function stopSR(sendIt) {
        if (!sr) return;
        sr._send = sendIt;
        try { sr.stop(); } catch { }
    }

    function voiceError(text) {
        if (tab !== "chat") setTab("chat");
        msgs.push({ role: "error", show: "🎤 " + text });
        persist(); render();
    }

    async function startRec() {
        if (busy) return;
        if (tab !== "chat") setTab("chat");
        if (!window.isSecureContext) {
            return voiceError(`Voice er jonno https lage. Ekhon khola ache: ${location.origin}\n` +
                "• Computer e: http://localhost:" + (location.port || "3000") + " diye kholo\n" +
                "• Phone e: Render er https link diye kholo (192.168... IP diye voice cholbe na)");
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            return voiceError("Ei browser e voice record hoy na. Chrome, Edge ba notun Safari use koro.");
        }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            const why = {
                NotAllowedError: "Mic er permission bondho. Address bar er bame 🔒 ba ⚙ icon e chap diye Microphone → Allow koro, tarpor page reload dao.",
                SecurityError: "Mic er permission bondho. Address bar er bame 🔒 icon e chap diye Microphone → Allow koro.",
                NotFoundError: "Kono microphone pawa jay nai. Mic laga ache kina dekho.",
                NotReadableError: "Mic onno kono app (Zoom/Meet/WhatsApp call) use korche. Oita bondho kore abar try koro.",
            }[e.name] || `Mic chalu hoy nai (${e.name || e.message}).`;
            return voiceError(why);
        }
        try {
            const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
            rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
            recChunks = [];
            rec.ondataavailable = (e) => e.data && e.data.size && recChunks.push(e.data);
            rec.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                const blob = new Blob(recChunks, { type: rec.mimeType || type || "audio/webm" });
                const discard = rec._discard;
                const secs = (Date.now() - recStart) / 1000;
                rec = null;
                if (discard) return;
                if (secs < 1 || blob.size < 1000) return voiceError("Recording khub choto chilo. 🎤 chap dao, kotha bolo, tarpor ■ chap dao.");
                send(blob);
            };
            rec.start(250);
            recUI(true);
        } catch (e) {
            stream.getTracks().forEach((t) => t.stop());
            rec = null;
            voiceError(`Record shuru hoy nai (${e.message}).`);
        }
    }
    function stopRec(discard) {
        if (!rec) return;
        recUI(false);
        if (rec.state === "recording") { rec._discard = discard; rec.stop(); }
    }

    /* ============================================================
       হিসাব DASHBOARD — server er analysis theke, AI chara (shonkha 100% thik)
       ============================================================ */
    const tk = (n) => (n < 0 ? "−" : "") + "৳" + Math.abs(Math.round(Number(n) || 0)).toLocaleString("en-IN");
    const num = (n) => Math.round(Number(n) || 0).toLocaleString("en-IN");
    const PERIODS = [["today", "আজ"], ["week", "৭ দিন"], ["month", "এই মাস"]];
    const periodLabel = () => (PERIODS.find((p) => p[0] === period) || PERIODS[0])[1];
    const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
    const BN_DAY = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহঃ", "শুক্র", "শনি"];

    async function loadDash() {
        dashLoading = true; renderDash();
        try {
            const r = await fetch(`${API}/overview?period=${period}`);
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || "সার্ভার সমস্যা");
            dash = d; dashErr = null;
        } catch (e) { dashErr = e.message; }
        dashLoading = false; renderDash();
    }

    const section = (title, page, inner) => `
      <section class="ai-sec">
        <div class="ai-sec-h"><b>${title}</b>${page ? `<a href="${page}">খুলুন ›</a>` : ""}</div>
        ${inner}
      </section>`;

    function renderDash() {
        if (tab !== "hisab") return;
        const chips = `<div class="ai-chips">${PERIODS.map(([k, l]) => `<button type="button" data-p="${k}" class="${k === period ? "on" : ""}">${l}</button>`).join("")}
            <button type="button" class="ai-ref" data-p="refresh" title="রিফ্রেশ">${ICON.refresh}</button></div>`;

        if (!dash) {
            dashEl.innerHTML = chips + (dashErr
                ? `<div class="ai-dash-msg err">⚠ ${esc(dashErr)}<br><button type="button" data-p="refresh">আবার চেষ্টা</button></div>`
                : `<div class="ai-dash-msg"><div class="ai-skel"></div><div class="ai-skel"></div><div class="ai-skel short"></div></div>`);
            bindDash();
            return;
        }
        const d = dash, P = periodLabel();
        const bk = d.bkash, en = d.entry, pw = d.pawna, bn = d.bank, gi = d.gila;

        const warn = d.warnings.length ? `
          <div class="ai-warn"><div class="ai-warn-h">${ICON.warn}<b>খেয়াল রাখুন</b></div>
            <ul>${d.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : "";

        const kpi = `<div class="ai-kpis">
            <a class="ai-kpi" href="/Bkash"><small>বিকাশ ব্যালেন্স</small><b>${tk(bk.totalBalance)}</b><span>${bk.accounts.length} টি অ্যাকাউন্ট</span></a>
            <a class="ai-kpi" href="/Entry"><small>হাসান পাওনা</small><b>${tk(en.hasanPawnaNow)}</b><span>${P}: ${tk(en.period.total)}</span></a>
            <a class="ai-kpi" href="/Bank"><small>ব্যাংক</small><b>${tk(bn.totalBalance)}</b><span>${bn.banks.length} টি ব্যাংক</span></a>
            <a class="ai-kpi" href="/Cash"><small>হাতে ক্যাশ</small><b>${tk(d.cash.balance)}</b><span>${P}: −${num(d.cash.period.given)} / +${num(d.cash.period.taken)}</span></a>
          </div>`;

        const bkash = bk.accounts.length ? section("বিকাশ", "/Bkash", bk.accounts.map((a) => {
            const used = 50000 - a.dailyRemaining;
            const p = pct(used, 50000);
            return `<div class="ai-acc">
              <div class="ai-acc-top"><div><b>${esc(a.name)}</b><small>${esc(a.number)}</small></div><b class="ai-amt ${a.balance < 1000 ? "bad" : ""}">${tk(a.balance)}</b></div>
              <div class="ai-bar ${p >= 80 ? "hot" : ""}"><i style="width:${p}%"></i></div>
              <div class="ai-acc-meta"><span>আজকের লিমিট বাকি <b>${tk(a.dailyRemaining)}</b></span><span>মাসে বাকি ${tk(a.monthlyRemaining)}</span></div>
              <div class="ai-acc-meta"><span>${P}: পাঠানো ${tk(a.period.sent)} · এসেছে ${tk(a.period.received)}</span>${a.bundleLeft ? `<span class="ai-pill">বান্ডেল ${a.bundleLeft}${a.bundleDaysLeft != null ? ` · ${a.bundleDaysLeft} দিন` : ""}</span>` : ""}</div>
            </div>`;
        }).join("")) : "";

        const max7 = Math.max(1, ...en.last7Days.map((x) => x.total));
        const entry = section("এন্ট্রি", "/Entry", `
            <div class="ai-row3"><div><small>${P} মোট</small><b>${tk(en.period.total)}</b></div><div><small>এন্ট্রি</small><b>${num(en.period.count)} টি</b></div><div><small>জমা</small><b>${tk(en.period.deposit)}</b></div></div>
            <div class="ai-spark">${en.last7Days.map((x) => {
                const dt = new Date(x.date + "T00:00:00");
                return `<div title="${x.date}: ${tk(x.total)}"><i style="height:${Math.max(3, pct(x.total, max7))}%" class="${x.date === d.today ? "now" : ""}"></i><small>${BN_DAY[dt.getDay()]}</small></div>`;
            }).join("")}</div>
            <div class="ai-acc-meta"><span>৭ দিনের গড় ${tk(en.last7Average)}/দিন</span></div>`);

        const pawna = pw.people.length ? section("পাওনা", "/Pawna", `
            <div class="ai-row2"><div class="good"><small>আমি পাবো</small><b>${tk(pw.totalTheyOweMe)}</b></div><div class="bad"><small>আমি দেবো</small><b>${tk(pw.totalIOwe)}</b></div></div>
            ${pw.people.filter((p) => p.net !== 0).slice(0, 5).map((p) => `<div class="ai-line"><span>${esc(p.name)}</span><b class="${p.net > 0 ? "good" : "bad"}">${p.net > 0 ? "পাবো " : "দেবো "}${tk(Math.abs(p.net))}</b></div>`).join("")}`) : "";

        const bank = bn.banks.length ? section("ব্যাংক", "/Bank", bn.banks.map((b) => `
            <div class="ai-line"><span>${esc(b.name)}${b.period.deposit || b.period.withdraw ? `<small>${P}: +${num(b.period.deposit)} / −${num(b.period.withdraw)}</small>` : ""}</span><b>${tk(b.balance)}</b></div>`).join("")) : "";

        const gila = gi.people.length ? section("গিলা", "/Gila", gi.people.map((g) => {
            const p = pct(g.piecesDone, g.piecesNeededForAdvance);
            return `<div class="ai-acc">
              <div class="ai-acc-top"><div><b>${esc(g.name)}</b><small>অগ্রিম ${tk(g.advance)} · ${tk(g.pricePerPiece)}/পিস</small></div><b class="ai-amt">${num(g.piecesDone)}/${num(g.piecesNeededForAdvance)}</b></div>
              <div class="ai-bar good"><i style="width:${p}%"></i></div>
              <div class="ai-acc-meta"><span>${g.piecesLeft > 0 ? `আরও <b>${num(g.piecesLeft)} পিস</b> বাকি` : g.piecesLeft === 0 ? "অগ্রিম মিটেছে ✓" : `${num(-g.piecesLeft)} পিস বেশি`}</span><span>${g.lastEntry ? "শেষ: " + g.lastEntry.slice(5) : "এখনো নেই"}</span></div>
            </div>`;
        }).join("")) : "";

        dashEl.innerHTML = chips + warn + kpi + bkash + entry + pawna + bank + gila + `
            <button type="button" class="ai-ask" data-p="ask">${ICON.spark} ${P}-এর হিসাব বুঝিয়ে বলুন</button>
            <div class="ai-foot-note">${dashLoading ? "আপডেট হচ্ছে…" : `আপডেট: ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}</div>`;
        bindDash();
    }

    function bindDash() {
        dashEl.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
            const v = b.dataset.p;
            if (v === "refresh") return loadDash();
            if (v === "ask") {
                ta.value = `${periodLabel()}-এর পুরো হিসাব সহজ করে বুঝিয়ে বলুন — কোথায় সাবধান হতে হবে?`;
                return send();
            }
            period = v; dash = null; loadDash();
        }));
    }
})();
