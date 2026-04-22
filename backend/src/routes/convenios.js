const express = require("express");
const router  = express.Router();
const { auth, requireActivePlan } = require("../middleware/auth");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const mw = [auth, requireActivePlan];

router.get("/", ...mw, async (req, res) => {
  try {
    const convs = await prisma.convenio.findMany({
      where: { userId: req.user.id, active: true },
      orderBy: { name: "asc" },
    });
    res.json(convs);
  } catch (err) { res.status(500).json({ error: "Erro ao listar convênios" }); }
});

router.post("/", ...mw, async (req, res) => {
  try {
    const { name, type, value, code } = req.body;
    if (!name || value === undefined) return res.status(400).json({ error: "Nome e valor são obrigatórios" });
    const conv = await prisma.convenio.create({
      data: { userId: req.user.id, name, type: type || "plano", value: parseFloat(value), code },
    });
    res.status(201).json(conv);
  } catch (err) { res.status(500).json({ error: "Erro ao criar convênio" }); }
});

router.put("/:id", ...mw, async (req, res) => {
  try {
    const exists = await prisma.convenio.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!exists) return res.status(404).json({ error: "Convênio não encontrado" });
    const { name, type, value, code, active } = req.body;
    const updated = await prisma.convenio.update({
      where: { id: req.params.id },
      data: { name, type, value: value !== undefined ? parseFloat(value) : undefined, code, active },
    });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: "Erro ao atualizar convênio" }); }
});

router.delete("/:id", ...mw, async (req, res) => {
  try {
    const exists = await prisma.convenio.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!exists) return res.status(404).json({ error: "Convênio não encontrado" });
    // Soft delete
    await prisma.convenio.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ message: "Convênio removido" });
  } catch (err) { res.status(500).json({ error: "Erro ao remover convênio" }); }
});

module.exports = router;