const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const authRoutes         = require("./routes/auth");
const patientRoutes      = require("./routes/patients");
const appointmentRoutes  = require("./routes/appointments");
const recordRoutes       = require("./routes/records");
const financialRoutes    = require("./routes/financial");
const convenioRoutes     = require("./routes/convenios");
const subscriptionRoutes = require("./routes/subscriptions");
const aiRoutes           = require("./routes/ai");
const adminRoutes        = require("./routes/admin");

const app = express();

// ── Trust proxy (Railway, Render, Heroku) ──────────────────
app.set("trust proxy", 1);

// ── Segurança ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // ajuste conforme necessário
}));
app.use(compression());

// ── CORS ───────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === "development") {
      cb(null, true);
    } else {
      cb(new Error("CORS bloqueado: " + origin));
    }
  },
  credentials: true,
}));

// ── Stripe Webhook (raw body obrigatório) ──────────────────
app.use("/api/subscriptions/webhook", express.raw({ type: "application/json" }));

// ── Body Parser ────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ──────────────────────────────────────────
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { error: "Muitas requisições" } }));
app.use("/api/auth/", rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "Muitas tentativas de autenticação" } }));

// ── Rotas ──────────────────────────────────────────────────
app.use("/api/auth",          authRoutes);
app.use("/api/patients",      patientRoutes);
app.use("/api/appointments",  appointmentRoutes);
app.use("/api/records",       recordRoutes);
app.use("/api/financial",     financialRoutes);
app.use("/api/convenios",     convenioRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/ai",            aiRoutes);
app.use("/api/admin",         adminRoutes);

// ── Health check ───────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0", service: "Calenio API" });
});

// ── 404 ────────────────────────────────────────────────────
app.use("*", (req, res) => res.status(404).json({ error: "Rota não encontrada" }));

// ── Error Handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("❌ Erro:", err.message);
  if (err.name === "ZodError") {
    return res.status(400).json({ error: "Dados inválidos", details: err.errors });
  }
  res.status(err.status || 500).json({ error: err.message || "Erro interno do servidor" });
});

module.exports = app;
