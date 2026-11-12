/* ============================================================
   DATE KEYS  (সার্ভারের টাইমজোন Asia/Dhaka)
   ============================================================ */
function dayKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function monthKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

module.exports = { dayKey, monthKey };
