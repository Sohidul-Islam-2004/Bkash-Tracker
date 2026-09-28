const dns = require('node:dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { PersonSchema, TransactionSchema } = require('./schema');
const { convertProcessSignalToExitCode } = require('node:util');
const { json } = require('node:stream/consumers');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const dbURI = process.env.DB_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const Person = mongoose.model("Person", PersonSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
mongoose.connect(dbURI)
    .then(() => console.log('Cloud Database connected successfully!'))
    .catch(err => console.error('Cloud DB connection error:', err));
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});


app.post("/api/people", upload.single("photo"), async (req, res) => {
    try {
        const {
            name,
            bkashNumber,
            whatsappNumber,
            initialBalance,
            dailyUsedBase,
            monthlyUsedBase
        } = req.body;

        let photoUrl = null;

        if (req.file) {
            const path = `ProfileImage/${Date.now()}-${req.file.originalname}`;

            const { error } = await supabase.storage
                .from("Bkash")
                .upload(path, req.file.buffer, {
                    contentType: req.file.mimetype,   // ← was `file`
                    upsert: false
                });

            if (error) throw new Error("photo upload failed: " + error.message);

            const { data } = supabase.storage.from("Bkash").getPublicUrl(path);
            photoUrl = data.publicUrl;
        }
       
        const person = await Person.create({
            name,
            bkashNumber,
            whatsappNumber,
            photo: photoUrl,                       // ← save it!
            initialBalance,
            dailyUsedBase,
            monthlyUsedBase
        });

        res.status(201).json(person);              // ← real response
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});

app.get("/api/people", async (req, res) => {
    const data = await Person.find();
    res.json(data);
})

app.get("/api/people/:id", async (req, res) => {

    const data = await Person.findById(req.params.id);
    res.json(data);


})

























































































































app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {


        return res.status(400).json({ success: false, message: `Multer Error: ${err.message}` });
    } else if (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next();
});

app.listen(process.env.PORT, () => {
    console.log("Server listening on port 3000");
});

module.exports = app; 
