/* ============================================================
   প্রতি রাত ১২টায় মেয়াদ শেষ হওয়া সেন্ড মানি বান্ডেল শূন্য করা
   ============================================================ */
const cron = require("node-cron");
const { Person } = require("../models");

function startBundleExpiryJob() {
    cron.schedule("0 0 * * *", async () => {
        try {
            const result = await Person.updateMany(
                { bundleExpiry: { $lte: new Date() } },
                { $set: { bundleCount: 0, bundleExpiry: null } }
            );
            console.log(`Expired ${result.modifiedCount} bundles.`);
        } catch (err) {
            console.error("Bundle expiry cron failed:", err.message);
        }
    });
}

module.exports = { startBundleExpiryJob };
