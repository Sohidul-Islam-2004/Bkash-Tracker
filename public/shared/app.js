/* ============================================================
   ইজি লেনদেন — shared helpers
   ------------------------------------------------------------
   সব পেজ এই ফাইলটা নিজের script.js-এর আগে লোড করে।
   এখানে যা আছে তা `App.` দিয়ে পাওয়া যায়, যেমন App.money(500)।
   ============================================================ */
const App = (() => {
    /* ---------- text ---------- */
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /* ---------- numbers ---------- */
    const BN_TO_EN = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
    const fromBn = s => String(s).replace(/[০-৯]/g, d => BN_TO_EN[d] || d);

    /* "১২,৫০০ টাকা" → 12500 */
    function parseNum(str) {
        const n = parseFloat(fromBn(str).replace(/[^\d.\-]/g, ''));
        return Number.isFinite(n) ? n : 0;
    }

    /* 1234567 → "1,234,567" */
    const num = n => Number(n || 0).toLocaleString('en-US');

    /* 1234567 → "৳12,34,567"   (-500 → "-৳500") */
    function money(n) {
        const v = Number(n || 0);
        return (v < 0 ? '-' : '') + '৳' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    }

    /* ---------- dates ---------- */
    const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
        'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
    const WEEKDAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

    /* "2026-11" → "নভেম্বর" */
    const monthName = ym => MONTHS[+ym.split('-')[1] - 1];

    /* "2026-11-12" → "বৃহস্পতিবার" */
    const weekday = iso => {
        const [y, m, d] = iso.split('-').map(Number);
        return WEEKDAYS[new Date(y, m - 1, d).getDay()];
    };

    /* আজকের তারিখ "YYYY-MM-DD" (ফোনের সময় অনুযায়ী) */
    function todayStr(d = new Date()) {
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }

    /* ISO সময় → "12/11/26 · 7:45 PM" */
    function fmtDateTime(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: '2-digit' });
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        return `${date} · ${time}`;
    }

    /* ---------- toast ---------- */
    let toastTimer = null;

    /* App.toast('সেভ হয়েছে', 'ok')  ·  kind: 'ok' | 'err' | ''
       opts: { actionLabel, onAction, duration } */
    function toast(msg, kind = '', opts = {}) {
        const el = document.getElementById('toast');
        if (!el) return;
        const type = kind === 'ok' || kind === 'success' ? 'ok'
            : kind === 'err' || kind === 'error' ? 'err' : '';

        el.textContent = '';
        if (type) {
            const icon = document.createElement('span');
            icon.className = 'toast-icon';
            icon.textContent = type === 'ok' ? '✓' : '!';
            el.appendChild(icon);
        }
        const text = document.createElement('span');
        text.className = 'toast-msg';
        text.textContent = msg;
        el.appendChild(text);

        if (opts.actionLabel && typeof opts.onAction === 'function') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toast-action';
            btn.textContent = opts.actionLabel;
            btn.onclick = () => { hideToast(); opts.onAction(); };
            el.appendChild(btn);
        }

        el.className = 'toast show ' + type;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, opts.duration || (opts.actionLabel ? 4500 : 2400));
    }

    function hideToast() {
        const el = document.getElementById('toast');
        if (el) el.classList.remove('show');
        clearTimeout(toastTimer);
    }

    /* ---------- clipboard ---------- */
    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            return true;
        } catch {
            return false;
        }
    }

    /* ---------- brand logo  (<div class="brand-logo"></div> ফাঁকা থাকলে নিজে বসে) ---------- */
    const LOGO = `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
                <linearGradient id="el-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#e8437a" />
                    <stop offset="55%" stop-color="#d12053" />
                    <stop offset="100%" stop-color="#a8153f" />
                </linearGradient>
            </defs>
            <rect width="100" height="100" rx="24" fill="url(#el-grad)" />
            <path d="M0 24 Q0 0 24 0 L76 0 Q100 0 100 24 L100 34 Q60 54 0 54 Z" fill="rgba(255,255,255,0.10)" />
            <text x="50" y="74" text-anchor="middle" font-family="'Noto Sans Bengali','Hind Siliguri',sans-serif"
                  font-size="60" font-weight="800" fill="#ffffff">ই</text>
            <circle cx="80" cy="22" r="5.5" fill="#ffffff" />
            <circle cx="80" cy="22" r="2.2" fill="#d12053" />
        </svg>`;

    function mountChrome() {
        document.querySelectorAll('.brand-logo').forEach(el => {
            if (!el.children.length) el.innerHTML = LOGO;
        });
        const topbar = document.querySelector('.topbar');
        if (topbar) {
            window.addEventListener('scroll',
                () => topbar.classList.toggle('scrolled', window.scrollY > 8), { passive: true });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountChrome);
    else mountChrome();

    /* ---------- জুম, কপি ও রাইট-ক্লিক বন্ধ (যে পেজে দরকার সে ডাকে) ---------- */
    function lockZoomAndCopy() {
        const editable = t => {
            const tag = (t.tagName || '').toLowerCase();
            return tag === 'input' || tag === 'textarea' || t.isContentEditable;
        };
        const stop = e => e.preventDefault();

        document.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false });
        ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, stop));
        ['touchstart', 'touchmove'].forEach(ev =>
            document.addEventListener(ev, e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false }));

        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && !editable(e.target) &&
                ['c', 'a', 'x', 's', 'u'].includes(e.key.toLowerCase())) e.preventDefault();
        });
        document.addEventListener('contextmenu', e => { if (!editable(e.target)) e.preventDefault(); });
    }

    return {
        esc, fromBn, parseNum, num, money,
        MONTHS, WEEKDAYS, monthName, weekday, todayStr, fmtDateTime,
        toast, hideToast, copyText, lockZoomAndCopy,
    };
})();
