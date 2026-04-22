const express = require("express");
const router  = express.Router();
const { auth, requireActivePlan } = require("../middleware/auth");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const mw = [auth, requireActivePlan];

// Listar lançamentos com filtros
router.get("/", ...mw, async (req, res) => {
  try {
    const { type, category, status, from, to, patientId } = req.query;
    const where = { userId: req.user.id };
    if (type)      where.type      = type;
    if (category)  where.category  = category;
    if (status)    where.status    = status;
    if (patientId) where.patientId = patientId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to)   where.date.lte = new Date(to);
    }

    const items = await prisma.financial.findMany({
      where, orderBy: { date: "desc" },
      include: { patient: { select: { id:true, name:true } } },
    });

    // Resumo
    const income  = items.filter(i => i.type === "INCOME"  && i.status === "PAID").reduce((s,i) => s + i.value, 0);
    const expense = items.filter(i => i.type === "EXPENSE" && i.status === "PAID").reduce((s,i) => s + i.value, 0);
    const pending = items.filter(i => i.type === "INCOME"  && i.status === "PENDING").reduce((s,i) => s + i.value, 0);

    res.json({ items, summary: { income, expense, pending, balance: income - expense } });
  } catch (err) { res.status(500).json({ error: "Erro ao listar financeiro" }); }
});

// Criar lançamento
router.post("/", ...mw, async (req, res) => {
  try {
    const { type, category, description, value, date, status, method, patientId } = req.body;
    if (!description || value === undefined) {
      return res.status(400).json({ error: "Descrição e valor são obrigatórios" });
    }
    const item = await prisma.financial.create({
      data: {
        userId: req.user.id, type: type || "INCOME",
        category: category || "particular", description,
        value: parseFloat(value), date: date ? new Date(date) : new Date(),
        status: status || "PENDING", method: method || null,
        patientId: patientId || null,
      },
    });
    res.status(201).json(item);
  } catch (err) { res.status(500).json({ error: "Erro ao criar lançamento" }); }
});

// Marcar como pago
router.patch("/:id/pay", ...mw, async (req, res) => {
  try {
    const item = await prisma.financial.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!item) return res.status(404).json({ error: "Lançamento não encontrado" });
    const updated = await prisma.financial.update({
      where: { id: req.params.id },
      data: { status: "PAID" },
    });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: "Erro ao atualizar" }); }
});

// Relatório para contador (agrupado por paciente)
router.get("/report/contador", ...mw, async (req, res) => {
  try {
    const { month, year } = req.query;
    const y = parseInt(year || new Date().getFullYear());
    const m = parseInt(month || new Date().getMonth() + 1);
    const from = new Date(y, m - 1, 1);
    const to   = new Date(y, m, 0, 23, 59, 59);

    const items = await prisma.financial.findMany({
      where: { userId: req.user.id, type: "INCOME", date: { gte: from, lte: to } },
      include: { patient: { select: { id:true, name:true } } },
      orderBy: { date: "asc" },
    });

    // Agrupa por paciente
    const byPatient = {};
    items.forEach(item => {
      const name = item.patient?.name || "Sem paciente";
      if (!byPatient[name]) byPatient[name] = { patient: name, sessions: 0, total: 0, category: item.category };
      byPatient[name].sessions++;
      byPatient[name].total += item.value;
    });

    const total = items.reduce((s, i) => s + i.value, 0);
    res.json({
      period: `${String(m).padStart(2,"0")}/${y}`,
      items: Object.values(byPatient),
      total,
      totalSessions: items.length,
    });
  } catch (err) { res.status(500).json({ error: "Erro ao gerar relatório" }); }
});

// Deletar
router.delete("/:id", ...mw, async (req, res) => {
  try {
    const item = await prisma.financial.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!item) return res.status(404).json({ error: "Lançamento não encontrado" });
    await prisma.financial.delete({ where: { id: req.params.id } });
    res.json({ message: "Lançamento excluído" });
  } catch (err) { res.status(500).json({ error: "Erro ao excluir" }); }
});

module.exports = router;