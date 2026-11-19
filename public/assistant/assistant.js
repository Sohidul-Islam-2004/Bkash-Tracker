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
        trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    };

    const fab = document.createElement("button");
    fab.className = "ai-fab";
    fab.type = "button";
    fab.title = "AI সহকারী";
    fab.innerHTML = ICON.spark;

    const panel = document.createElement("div");
    panel.className = "ai-panel";
    panel.innerHTML = `
      <div class="ai-head">
        <div class="ai-title"><span class="ai-dot">${ICON.spark}</span><div><b>AI সহকারী</b><small>লিখুন, বলুন বা ছবি দিন</small></div></div>
        <button class="ai-ibtn" data-act="clear" title="চ্যাট মুছুন">${ICON.trash}</button>
        <button class="ai-ibtn" data-act="close" title="বন্ধ">${ICON.x}</button>
      </div>
      <div class="ai-body"></div>
      <div class="ai-img-chip" hidden><img alt=""><span>ছবি যুক্ত হয়েছে</span><button type="button" title="বাদ">${ICON.x}</button></div>
      <div class="ai-rec" hidden><span class="ai-rec-dot"></span><span class="ai-rec-time">0:00</span> শুনছি… শেষ হলে ■ চাপুন</div>
      <form class="ai-input">
        <button type="button" class="ai-ibtn" data-act="photo" title="ছবি">${ICON.cam}</button>
        <input type="file" accept="image/*" hidden>
        <textarea rows="1" placeholder="যেমন: Salam এর বিকাশ থেকে ৫০০০ send"></textarea>
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
    const open = () => { panel.classList.add("open"); fab.classList.add("hide"); render(); setTimeout(() => ta.focus(), 150); };
    const close = () => { panel.classList.remove("open"); fab.classList.remove("hide"); stopRec(true); };
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
                <b>কী করতে চান?</b>
                <p>হিসাব যোগ করুন বা জিজ্ঞেস করুন — সেভের আগে আপনি Confirm করবেন।</p>
                ${["আজকে সব হিসাব কেমন?", "Salam er bkash e koto taka ache?", "01711223344 5000\n01812345678 2000 entry koro", "Rahim ke 2000 dhar dilam"]
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
            return `<div class="ai-row"><div class="ai-bub ai-md">${md(m.show)}</div></div>${cards}
                ${pend > 1 ? `<div class="ai-all"><button type="button" data-all="${i}">✓ সব Confirm (${pend})</button></div>` : ""}`;
        }).join("") + (busy ? `<div class="ai-row"><div class="ai-bub ai-typing"><i></i><i></i><i></i></div></div>` : "");

        body.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => confirmAction(...b.dataset.ok.split(":").map(Number))));
        body.querySelectorAll("[data-no]").forEach((b) => (b.onclick = () => cancelAction(...b.dataset.no.split(":").map(Number))));
        body.querySelectorAll("[data-all]").forEach((b) => (b.onclick = () => confirmAll(Number(b.dataset.all))));
        body.querySelectorAll("[data-refresh]").forEach((b) => (b.onclick = () => location.reload()));
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

    /* ---------- send ---------- */
    function history() {
        return msgs.filter((m) => m.role === "user" || m.role === "assistant").slice(-12).map((m) => ({ role: m.role, content: m.ctx || m.show || "" }));
    }

    async function send(audioBlob) {
        if (busy) return;
        const text = ta.value.trim();
        if (!text && !audioBlob && !imageFile) return;

        const fd = new FormData();
        fd.append("history", JSON.stringify(history()));
        if (text) fd.append("text", text);
        if (audioBlob) fd.append("audio", audioBlob, "voice." + (audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm"));
        if (imageFile) fd.append("image", imageFile, imageFile.name || "photo.jpg");

        const userMsg = { role: "user", show: text || (audioBlob ? "…" : ""), img: !!imageFile, voice: !!audioBlob };
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
    micBtn.onclick = () => (rec ? stopRec(false) : startRec());

    function voiceError(text) {
        msgs.push({ role: "error", show: "🎤 " + text });
        persist(); render();
    }

    async function startRec() {
        if (busy) return;
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
            recStart = Date.now();
            micBtn.classList.add("on"); micBtn.innerHTML = ICON.stop;
            $(".ai-rec").hidden = false;
            recTimer = setInterval(() => {
                const s = Math.floor((Date.now() - recStart) / 1000);
                $(".ai-rec-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
                if (s >= 120) stopRec(false);
            }, 250);
        } catch (e) {
            stream.getTracks().forEach((t) => t.stop());
            rec = null;
            voiceError(`Record shuru hoy nai (${e.message}).`);
        }
    }
    function stopRec(discard) {
        clearInterval(recTimer);
        micBtn.classList.remove("on"); micBtn.innerHTML = ICON.mic;
        $(".ai-rec").hidden = true;
        $(".ai-rec-time").textContent = "0:00";
        if (rec && rec.state === "recording") { rec._discard = discard; rec.stop(); }
    }
})();