/* ============================================================
   গিলার হিসাব  —  /Gila/persons
   ============================================================ */
const express = require("express");
const { Gila } = require("../models");

const router = express.Router();

router.get("/Gila/persons", async (req, res) => {
    const data = await Gila.find();
    res.json(data.map((p) => ({
        id: p._id, name: p.name, advance: p.advance, price: p.price,
        totalPieces: (p.entries || []).reduce((s, e) => s + (e.pieces || 0), 0),
    })));
});

router.post("/Gila/persons", async (req, res) => {
    const { name, advance, price } = req.body;
    const data = await Gila.create({ name, advance, price });
    res.status(201).json({ id: data._id, name: data.name, advance: data.advance, price: data.price, totalPieces: 0 });
});

router.put("/Gila/persons/:id", async (req, res) => {
    const { name, advance, price } = req.body;
    const data = await Gila.findByIdAndUpdate(req.params.id, { name, advance, price }, { new: true });
    if (!data) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    res.json({
        id: data._id, name: data.name, advance: data.advance, price: data.price,
        totalPieces: (data.entries || []).reduce((s, e) => s + (e.pieces || 0), 0),
    });
});

router.delete("/Gila/persons/:id", async (req, res) => {
    const data = await Gila.findByIdAndDelete(req.params.id);
    if (!data) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    res.status(204).end();
});

router.get("/Gila/persons/:id/entries", async (req, res) => {
    const person = await Gila.findById(req.params.id);
    if (!person) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    res.json(person.entries);
});

router.put("/Gila/persons/:id/entries/:date", async (req, res) => {
    const { pieces } = req.body;
    const { id, date } = req.params;
    const person = await Gila.findById(id);
    if (!person) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    const existing = person.entries.find((e) => e.date === date);
    if (existing) existing.pieces = pieces;
    else person.entries.push({ date, pieces });
    await person.save();
    const saved = person.entries.find((e) => e.date === date);
    res.json({ id: saved._id, personId: person._id, date: saved.date, pieces: saved.pieces });
});

router.delete("/Gila/persons/:id/entries/:date", async (req, res) => {
    const { id, date } = req.params;
    const person = await Gila.findById(id);
    if (!person) return res.status(404).json({ message: "ব্যক্তি পাওয়া যায়নি" });
    person.entries = person.entries.filter((e) => e.date !== date);
    await person.save();
    res.status(204).end();
});

module.exports = router;
