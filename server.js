/* ============================================================
   ইজি লেনদেন  —  server
   ------------------------------------------------------------
   public/        পেজগুলো (ড্যাশবোর্ড + Entry, Bkash, Raf, Gila, Pawna, Bank, Cash)
   src/routes/    API
   src/models/    MongoDB মডেল
   ============================================================ */

/* টাইমজোন সবার আগে — তারিখের হিসাব এর উপর নির্ভর করে */
process.env.TZ = "Asia/Dhaka";
require("dotenv").config();

const path = require("path");
const dns = require("node:dns");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const { PORT } = require("./src/config");
const routes = require("./src/routes");
const { errorHandler } = require("./src/lib/errors");
const { dayKey } = require("./src/lib/dates");
const { startBundleExpiryJob } = require("./src/jobs/bundleExpiry");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

/* ---------- app ---------- */
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(routes);
app.use(errorHandler);

/* ---------- database ---------- */
mongoose
    .connect(process.env.DB_URL)
    .then(() => console.log("Cloud Database connected successfully!"))
    .catch((err) => console.error("Cloud DB connection error:", err));

/* ---------- start ---------- */
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`Today: ${dayKey(new Date())}`);
});

startBundleExpiryJob();

module.exports = app;
