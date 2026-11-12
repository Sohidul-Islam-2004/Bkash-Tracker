/* ============================================================
   MODELS  —  মডেলের নাম বদলালে MongoDB collection-এর নামও বদলে যায়, তাই নাম একই রাখুন
   ============================================================ */
const mongoose = require("mongoose");
const schemas = require("./schemas");

module.exports = {
    Person: mongoose.model("Person", schemas.PersonSchema),
    Transaction: mongoose.model("Transaction", schemas.TransactionSchema),
    Entries: mongoose.model("Entries", schemas.EntriesSchema),
    Gila: mongoose.model("Gila", schemas.GilaPersonSchema),
    PawnaPerson: mongoose.model("Pawna", schemas.PawnaPersonSchema),
    Bank: mongoose.model("Bank", schemas.BankSchema),
    Cash: mongoose.model("Cash", schemas.CashSchema),
    User: mongoose.model("User", schemas.UserSchema),
};
