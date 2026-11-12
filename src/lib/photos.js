/* ============================================================
   PROFILE PHOTOS  (Supabase storage + multer upload)
   ============================================================ */
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const { HttpError } = require("./http");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const BUCKET = "Bkash";

/* ছবি মেমোরিতে নিয়ে সরাসরি Supabase-এ পাঠানো হয় (সর্বোচ্চ ১০ MB) */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

async function uploadPhoto(file) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `ProfileImage/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file.buffer, {
        contentType: file.mimetype, upsert: false,
    });
    if (error) throw new HttpError(400, "photo upload failed: " + error.message);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
}

async function deletePhoto(url) {
    if (!url) return;
    try {
        const marker = `/object/public/${BUCKET}/`;
        const i = url.indexOf(marker);
        if (i === -1) return;
        const storagePath = decodeURIComponent(url.slice(i + marker.length));
        const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
        if (error) console.error("photo delete failed:", error.message);
    } catch (err) {
        console.error("photo delete failed:", err.message);
    }
}

module.exports = { upload, uploadPhoto, deletePhoto };
