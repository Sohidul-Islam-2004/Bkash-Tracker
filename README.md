# ইজি লেনদেন

বিকাশ ব্যবসার হিসাব রাখার অ্যাপ — Node/Express + MongoDB।

## চালানো

```
npm install
cp .env.example .env      # নিজের DB_URL, SUPABASE_URL, SUPABASE_KEY বসান
npm start                 # অথবা npm run dev (ফাইল বদলালে নিজে রিস্টার্ট হয়)
```

## কোথায় কী

```
server.js              শুধু চালু করার কোড
src/
  config.js            পোর্ট, দৈনিক/মাসিক লিমিট
  routes/              API — প্রতি পেজের জন্য এক ফাইল
    entries.js         সালাম ভাইয়ের লেনদেন
    people.js          বিকাশ ম্যানেজমেন্ট
    gila.js  pawna.js  bank.js  cash.js
  models/schemas.js    ডাটাবেজের ছাঁচ
  lib/                 ছোট সাহায্যকারী কোড (ছবি আপলোড, তারিখ, এরর)
  jobs/                সময়মতো নিজে চলা কাজ
public/
  index.html  home.css  home.js     ড্যাশবোর্ড
  shared/
    base.css           রং, টপবার, toast — সব পেজের জন্য এক জায়গায়
    app.js             সব পেজের সাধারণ ফাংশন (টাকা/তারিখ লেখা, toast, কপি)
    parser.js          WhatsApp মেসেজ থেকে নম্বর ও টাকা বের করা (Entry + Raf)
    icon.svg           লোগো
  Entry/ Bkash/ Raf/ Gila/ Pawna/ Bank/ Cash/
    index.html  script.js  style.css
```

## সাধারণ কাজ

- **রং বদলাতে:** `public/shared/base.css` এর উপরের `:root` অংশ।
- **ড্যাশবোর্ডে নতুন পেজ:** `public/home.js` এর `SERVICES` তালিকায় এক লাইন।
- **মেসেজ পড়ার নিয়ম বদলাতে:** `public/shared/parser.js`। সার্ভারও একই নিয়মে যাচাই করে — `src/routes/entries.js`।
