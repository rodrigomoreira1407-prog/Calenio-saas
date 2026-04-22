const express = require("express");
const router  = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const mw = [auth, requireAdmin];

// Dashboard de métricas do sistema
router.get("/metrics", ...mw, async (req, res) => {
  try {
    const [totalUsers, activePlans, trialUsers, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { planStatus: "ACTIVE" } }),
      prisma.user.count({ where: { planStatus: "TRIAL" } }),
      prisma.user.count({ where: { plan: { not: "FREE" } } }),
    ]);
    res.json({ totalUsers, activePlans, trialUsers, paidUsers: revenue });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar métricas" });
  }
});

// Listar todos os usuários (admin)
router.get("/users", ...mw, async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    const users = await prisma.user.findMany({
      where, skip: (page-1) * limit, take: parseInt(limit),
      orderBy: { createdAt: "desc" },
      select: { id:true, name:true, email:true, plan:true, planStatus:true, createdAt:true, lastLoginAt:true, crp:true },
    });
    const total = await prisma.user.count({ where });
    res.json({ users, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: "Erro ao listar usuários" });
  }
});

// Alterar plano de usuário manualmente (admin)
router.patch("/users/:id/plan", ...mw, async (req, res) => {
  try {
    const { plan, planStatus } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { plan, planStatus, planExpiresAt: planStatus === "ACTIVE" ? new Date(Date.now() + 30*864e5) : null },
    });
    res.json({ message: "Plano atualizado", user: { id: user.id, plan: user.plan, planStatus: user.planStatus } });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar plano" });
  }
});

module.exports = router;