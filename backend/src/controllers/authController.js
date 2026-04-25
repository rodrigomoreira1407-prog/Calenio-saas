const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { PrismaClient } = require("@prisma/client");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../services/email");

const prisma = new PrismaClient();

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { name, email, password, crp } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Senha deve ter mínimo 6 caracteres" });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: "Este e-mail já está cadastrado" });

    const passwordHash = await bcrypt.hash(password, 12);
    const emailVerifyToken = uuid();
    const trialEndsAt = new Date(Date.now() + parseInt(process.env.TRIAL_DAYS || "14") * 864e5);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
        crp: crp || null,
        emailVerifyToken,
        emailVerified: true, // auto-verificado
        planStatus: "TRIAL",
        trialEndsAt,
      },
    });

    // Tenta enviar e-mail mas não bloqueia o cadastro se falhar
    try {
      await sendVerificationEmail(user.email, user.name, emailVerifyToken);
    } catch (emailErr) {
      console.error("Falha ao enviar e-mail de verificação:", emailErr.message);
    }

    res.status(201).json({
      message: "Conta criada com sucesso! Você já pode fazer login.",
      userId: user.id,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Erro ao criar conta" });
  }
};

// GET /api/auth/verify/:token
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await prisma.user.findFirst({ where: { emailVerifyToken: token } });
    if (!user) return res.status(400).json({ error: "Token inválido ou expirado" });

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null },
    });

    const jwtToken = signToken(user.id);
    res.json({ message: "E-mail confirmado com sucesso!", token: jwtToken });
  } catch (err) {
    res.status(500).json({ error: "Erro ao verificar e-mail" });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ error: "E-mail ou senha incorretos" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "E-mail ou senha incorretos" });

    // Atualiza lastLogin
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = signToken(user.id);
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        plan: user.plan, planStatus: user.planStatus,
        trialEndsAt: user.trialEndsAt, planExpiresAt: user.planExpiresAt,
        crp: user.crp, role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Erro ao fazer login" });
  }
};

// GET /api/auth/me
exports.me = async (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, name: u.name, email: u.email, crp: u.crp,
    phone: u.phone, specialty: u.specialty, role: u.role,
    plan: u.plan, planStatus: u.planStatus,
    trialEndsAt: u.trialEndsAt, planExpiresAt: u.planExpiresAt,
  });
};

// PUT /api/auth/profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, crp, phone, specialty, bio } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { name, crp, phone, specialty },
    });
    res.json({ message: "Perfil atualizado!", user: { name: user.name, crp: user.crp } });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar perfil" });
  }
};

// PUT /api/auth/password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: "Senha atual incorreta" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Nova senha muito curta" });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    res.json({ message: "Senha alterada com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao alterar senha" });
  }
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });
    if (!user) return res.json({ message: "Se o e-mail existir, você receberá instruções." });

    const token = uuid();
    const expires = new Date(Date.now() + 3600000); // 1 hora
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpires: expires },
    });
    await sendPasswordResetEmail(user.email, user.name, token);
    res.json({ message: "E-mail de recuperação enviado!" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao enviar e-mail" });
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    const user = await prisma.user.findFirst({
      where: { passwordResetToken: token, passwordResetExpires: { gt: new Date() } },
    });
    if (!user) return res.status(400).json({ error: "Token inválido ou expirado" });
    if (!password || password.length < 6) return res.status(400).json({ error: "Senha muito curta" });

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetToken: null, passwordResetExpires: null },
    });
    res.json({ message: "Senha redefinida com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao redefinir senha" });
  }
};

// POST /api/auth/resend-verification
exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });
    if (!user || user.emailVerified) return res.json({ message: "Se necessário, o e-mail foi reenviado." });
    const token = uuid();
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifyToken: token } });
    await sendVerificationEmail(user.email, user.name, token);
    res.json({ message: "E-mail de verificação reenviado!" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao reenviar e-mail" });
  }
};
