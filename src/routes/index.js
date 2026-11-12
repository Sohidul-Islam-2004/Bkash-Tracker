/* ============================================================
   সব route এক জায়গায়  —  URL আগের মতোই আছে
   ============================================================ */
const express = require("express");

const router = express.Router();

router.use(require("./people"));
router.use(require("./entries"));
router.use(require("./gila"));
router.use(require("./pawna"));
router.use(require("./bank"));
router.use(require("./cash"));

module.exports = router;
