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



app.post("/api/people", (req, res) => {
    console.log(req.body);
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
