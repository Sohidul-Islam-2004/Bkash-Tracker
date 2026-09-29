require('dotenv').config();
const path = require('path');
const dns = require('node:dns');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { PersonSchema, TransactionSchema } = require('./schema');

// Configure DNS
dns.setServers(['1.1.1.1', '8.8.8.8']);

const app = express();

// Middleware Stack
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Databases Initialization
const dbURI = process.env.DB_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const Person = mongoose.model('Person', PersonSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

mongoose.connect(dbURI)
    .then(() => console.log('Cloud Database connected successfully!'))
    .catch(err => console.error('Cloud DB connection error:', err));

// File Storage Setup
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// --- API Routes ---

// Create Person
app.post('/api/people', upload.single('photo'), async (req, res) => {
    try {
        const { name, bkashNumber, whatsappNumber, initialBalance, dailyUsedBase, monthlyUsedBase } = req.body;
        let photoUrl = null;

        if (req.file) {
            const storagePath = `ProfileImage/${Date.now()}-${req.file.originalname}`;

            const { error } = await supabase.storage
                .from('Bkash')
                .upload(storagePath, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: false
                });

            if (error) throw new Error('photo upload failed: ' + error.message);

            const { data } = supabase.storage.from('Bkash').getPublicUrl(storagePath);
            photoUrl = data.publicUrl;
        }

        const person = await Person.create({
            name,
            bkashNumber,
            whatsappNumber,
            photo: photoUrl,
            initialBalance,
            dailyUsedBase,
            monthlyUsedBase
        });

        res.status(201).json(person);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});

// Get All People
app.get('/api/people', async (req, res) => {
    const data = await Person.find();
    res.json(data);
});

// Get Person By ID
app.get('/api/people/:id', async (req, res) => {
    const data = await Person.findById(req.params.id).populate('transactions');

    res.json(data);
});
app.delete("/api/transactions/:id", async (req, res) => {
    try {

        await Transaction.findByIdAndDelete(req.params.id);
        res.status(200).json({ msg: "ok" });

    } catch (error) {
        console.error('Error during deletion:', error);
        res.status(500).json({ error: 'Internal server error' });
    }

})
app.delete('/api/people/:id', async (req, res) => {
    try {

        const deletedPerson = await Person.findByIdAndDelete(req.params.id);
        const deletionResult = await Transaction.deleteMany({ person: req.params.id });

        console.log('Deleted Person:', deletedPerson);
        console.log('Transactions Deletion Result:', deletionResult);

        res.status(200).json({ msg: "ok" });

    } catch (error) {
        console.error('Error during deletion:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create Transaction & Update Balance Ledger
app.post('/api/transactions/:id', async (req, res) => {
    try {

        const { type, amount, counterparty, date, trxId, notes } = req.body;

        const PersonData = await Person.findById(req.params.id);
        let updateData;

        if (type === 'send') {
            updateData = {
                initialBalance: PersonData.initialBalance - amount,
                dailyUsedBase: PersonData.dailyUsedBase + amount,
                monthlyUsedBase: PersonData.monthlyUsedBase + amount
            };
        } else {
            updateData = {
                initialBalance: PersonData.initialBalance + amount
            };
        }

        const cur = await Transaction.create({
            person: req.params.id,
            type,
            amount,
            date,
            counterparty,
            trxId,
            notes
        });



        const updatedPerson = await Person.findByIdAndUpdate(
            req.params.id,
            {
                ...updateData,
                $push: { transactions: cur._id }
            },
            {
                new: true,
                runValidators: true
            }
        );



        res.end();
    } catch (error) {

        res.json({ msg: error });
    }
});

// --- Error Handling Middleware ---
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: `Multer Error: ${err.message}` });
    } else if (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next();
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
