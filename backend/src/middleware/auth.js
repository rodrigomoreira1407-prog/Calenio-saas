const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Verifica JWT e carrega usuário no req.user
async function auth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token não fornecido" });
    }
    const token = header.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(401).json({ error: "Usuário não encontrado" });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expirado", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Verifica se a assinatura está ativa (não bloqueada por inadimplência)
function requireActivePlan(req, res, next) {
  const { planStatus } = req.user;

  if (planStatus === "BLOCKED" || planStatus === "CANCELED") {
    return res.status(403).json({
      error: "Acesso bloqueado. Renove sua assinatura.",
      code: "PLAN_BLOCKED",
      redirect: "/plans",
    });
  }

  // Verifica trial expirado
  if (planStatus === "TRIAL" && req.user.trialEndsAt) {
    if (new Date() > new Date(req.user.trialEndsAt)) {
      return res.status(403).json({
        error: "Período de trial encerrado. Assine um plano para continuar.",
        code: "TRIAL_EXPIRED",
        redirect: "/plans",
      });
    }
  }

  next();
}

// Requer plano específico (ex: PRO para usar IA)
function requirePlan(...plans) {
  return (req, res, next) => {
    if (!plans.includes(req.user.plan)) {
      return res.status(403).json({
        error: `Este recurso requer o plano: ${plans.join(" ou ")}`,
        code: "PLAN_INSUFFICIENT",
        currentPlan: req.user.plan,
        requiredPlan: plans,
      });
    }
    next();
  };
}

// Admin do sistema
function requireAdmin(req, res, next) {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  next();
}

module.exports = { auth, requireActivePlan, requirePlan, requireAdmin };