const express = require("express");
const router  = express.Router();
const { auth } = require("../middleware/auth");
const { PrismaClient } = require("@prisma/client");
const { sendWelcomeEmail } = require("../services/email");

const prisma = new PrismaClient();
let stripe;
try { stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); } catch(e) {}

// Criar sessão de checkout
router.post("/checkout", auth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe não configurado" });
    const { plan, billing } = req.body; // plan: BASIC|PRO, billing: monthly|yearly
    const priceKey = `STRIPE_PRICE_${plan}_${(billing||"monthly").toUpperCase()}`;
    const priceId = process.env[priceKey];
    if (!priceId) return res.status(400).json({ error: "Plano inválido" });

    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email, name: req.user.name,
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;
      await prisma.user.update({ where: { id: req.user.id }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/payment-success?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/plans`,
      metadata: { userId: req.user.id, plan },
      subscription_data: { trial_from_plan: false },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Erro ao criar checkout" });
  }
});

// Webhook Stripe (body raw obrigatório — configurado no app.js)
router.post("/webhook", async (req, res) => {
  try {
    if (!stripe) return res.sendStatus(200);
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send("Webhook error: " + err.message);
    }

    // Assinatura ativada
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const plan   = session.metadata?.plan || "BASIC";
      if (userId) {
        const user = await prisma.user.update({
          where: { id: userId },
          data: {
            plan,
            planStatus: "ACTIVE",
            stripeSubscriptionId: session.subscription,
            planExpiresAt: new Date(Date.now() + 30 * 864e5),
          },
        });
        try { await sendWelcomeEmail(user.email, user.name, plan); } catch(e) {}
      }
    }

    // Pagamento falhou — bloqueia
    if (event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      await prisma.user.updateMany({
        where: { stripeSubscriptionId: inv.subscription },
        data: { planStatus: "PAST_DUE" },
      });
    }

    // Assinatura cancelada
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      await prisma.user.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { plan: "FREE", planStatus: "CANCELED", stripeSubscriptionId: null, planExpiresAt: null },
      });
    }

    // Renovação paga com sucesso
    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      if (inv.billing_reason === "subscription_cycle") {
        await prisma.user.updateMany({
          where: { stripeSubscriptionId: inv.subscription },
          data: { planStatus: "ACTIVE", planExpiresAt: new Date(Date.now() + 30 * 864e5) },
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// Status da assinatura
router.get("/status", auth, async (req, res) => {
  const u = req.user;
  const trialDaysLeft = u.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(u.trialEndsAt) - Date.now()) / 864e5))
    : 0;
  res.json({
    plan: u.plan, planStatus: u.planStatus,
    planExpiresAt: u.planExpiresAt, trialEndsAt: u.trialEndsAt, trialDaysLeft,
    isActive: ["ACTIVE", "TRIAL"].includes(u.planStatus),
  });
});

// Portal Stripe para gerenciar assinatura
router.post("/portal", auth, async (req, res) => {
  try {
    if (!stripe || !req.user.stripeCustomerId) {
      return res.status(400).json({ error: "Sem assinatura ativa pelo Stripe" });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/settings`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: "Erro ao abrir portal" });
  }
});

module.exports = router;