/* ============================================================
   ERROR HANDLER  —  সব ভুল JSON আকারে যায়, যাতে অ্যাপ বার্তাটা দেখাতে পারে
   ============================================================ */
function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    let status = err.status || err.statusCode || 500;
    let message = err.message || "সার্ভার ত্রুটি";

    /* একই বিকাশ নম্বর দুইবার */
    if (err.code === 11000 && err.keyPattern && err.keyPattern.bkashNumber) {
        status = 400;
        message = "This bKash number is already added";
    } else if (err.name === "ValidationError" || err.name === "CastError" || err.name === "MulterError") {
        status = 400;
    }

    if (status >= 500) console.error(`${req.method} ${req.originalUrl} failed:`, err);
    res.status(status).json({ message, error: message });
}

module.exports = { errorHandler };
