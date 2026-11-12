/* ============================================================
   ইজি লেনদেন — ড্যাশবোর্ড
   নতুন পেজ যোগ করতে হলে SERVICES এ এক লাইন যোগ করুন।
   ============================================================ */

const ICONS = {
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M8.5 11.5h7M8.5 14.5h4"/>',
    wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="8" y1="18" x2="16" y2="18"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    bank: '<path d="M3 21h18"/><path d="M4 10h16"/><path d="M12 3 3 8v2h18V8z"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>'
};

const SERVICES = [
    { url: '/Entry/', icon: 'chat', title: 'সালাম ভাইয়ের সাথে লেনদেন', note: 'WhatsApp মেসেজ থেকে প্রতিদিনের হিসাব' },
    { url: '/Bkash/', icon: 'wallet', title: 'বিকাশ ম্যানেজমেন্ট', note: 'কোন নম্বরে কত ব্যালেন্স ও লিমিট' },
    { url: '/Raf/', icon: 'calc', title: 'বিকাশ রাফ হিসাব', note: 'নম্বর ও টাকা পেস্ট করে দ্রুত যোগফল' },
    { url: '/Gila/', icon: 'box', title: 'গিলার হিসাব', note: 'কার কত গিলা, মাস ধরে' },
    { url: '/Pawna/', icon: 'swap', title: 'দেনা পাওনার হিসাব', note: 'কে কত পাবে, কাকে কত দিতে হবে' },
    { url: '/Bank/', icon: 'bank', title: 'ব্যাংক হিসাব', note: 'ব্যাংকে জমা ও উত্তোলন' },
    { url: '/Cash/', icon: 'cash', title: 'ক্যাশের হিসাব', note: 'হাতে নগদ কত আছে' }
];

const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

document.getElementById('services').innerHTML = SERVICES.map((s, i) => `
    <a class="service" href="${s.url}" style="animation-delay:${i * 40}ms">
        <span class="service-ico">${svg(ICONS[s.icon])}</span>
        <span class="service-text">
            <b>${App.esc(s.title)}</b>
            <small>${App.esc(s.note)}</small>
        </span>
        <span class="service-go">${svg('<polyline points="9 18 15 12 9 6"/>')}</span>
    </a>`).join('');

document.getElementById('svcCount').textContent = SERVICES.length + ' টি';

/* আজকের তারিখ */
const today = App.todayStr();
const [y, m, d] = today.split('-').map(Number);
document.getElementById('heroDay').textContent = 'আজ ' + App.weekday(today);
document.getElementById('heroDate').textContent = `${d} ${App.MONTHS[m - 1]} ${y}`;
