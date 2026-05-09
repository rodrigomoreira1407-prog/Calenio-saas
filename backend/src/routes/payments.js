const express  = require("express");
const router   = express.Router();
const https    = require("https");
const crypto   = require("crypto");
const { auth, requireActivePlan } = require("../middleware/auth");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const mw = [auth, requireActivePlan];

// ── Criptografia das chaves ────────────────────────────────────
const ENC_KEY = (process.env.ENCRYPTION_KEY || "calenio_default_encryption_key_32").slice(0, 32).padEnd(32, "_");
const IV_LEN  = 16;

function encrypt(text) {
  if (!text) return null;
  const iv  = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENC_KEY), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + enc.toString("hex");
}

function decrypt(enc) {
  if (!enc) return null;
  try {
    const [ivHex, dataHex] = enc.split(":");
    const iv     = Buffer.from(ivHex, "hex");
    const data   = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENC_KEY), iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch { return null; }
}

function maskKey(key) {
  if (!key || key.length < 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

// ── Helper: HTTP request ───────────────────────────────────────
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── GET /api/payments/gateways ─────────────────────────────────
router.get("/gateways", ...mw, async (req, res) => {
  try {
    const gateways = await prisma.paymentGateway.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "asc" },
    });
    const result = gateways.map((g) => ({
      id:         g.id,
      provider:   g.provider,
      apiKeyMask: g.apiKeyEnc ? maskKey(decrypt(g.apiKeyEnc) || "") : null,
      pixKey:     g.pixKey,
      pixKeyType: g.pixKeyType,
      holderName: g.holderName,
      active:     g.active,
    }));
    res.json(result);
  } catch (err) {
    console.error("payments/gateways GET:", err);
    res.status(500).json({ error: "Erro ao listar gateways" });
  }
});

// ── POST /api/payments/gateways ────────────────────────────────
router.post("/gateways", ...mw, async (req, res) => {
  try {
    const { provider, apiKey, pixKey, pixKeyType, holderName } = req.body;
    if (!provider) return res.status(400).json({ error: "Provider obrigatório" });

    const VALID = ["mercadopago", "asaas", "pix_manual"];
    if (!VALID.includes(provider)) return res.status(400).json({ error: "Provider inválido" });

    const data = {
      userId:     req.user.id,
      provider,
      apiKeyEnc:  apiKey ? encrypt(apiKey) : undefined,
      pixKey:     pixKey     || null,
      pixKeyType: pixKeyType || null,
      holderName: holderName || null,
      active:     true,
    };

    const gateway = await prisma.paymentGateway.upsert({
      where:  { userId_provider: { userId: req.user.id, provider } },
      update: data,
      create: data,
    });

    res.json({
      id:         gateway.id,
      provider:   gateway.provider,
      apiKeyMask: gateway.apiKeyEnc ? maskKey(decrypt(gateway.apiKeyEnc) || "") : null,
      pixKey:     gateway.pixKey,
      pixKeyType: gateway.pixKeyType,
      holderName: gateway.holderName,
      active:     gateway.active,
    });
  } catch (err) {
    console.error("payments/gateways POST:", err);
    res.status(500).json({ error: "Erro ao salvar gateway" });
  }
});

// ── DELETE /api/payments/gateways/:id ─────────────────────────
router.delete("/gateways/:id", ...mw, async (req, res) => {
  try {
    const gw = await prisma.paymentGateway.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!gw) return res.status(404).json({ error: "Gateway não encontrado" });
    await prisma.paymentGateway.delete({ where: { id: req.params.id } });
    res.json({ message: "Gateway removido" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao remover gateway" });
  }
});

// ── POST /api/payments/charge ──────────────────────────────────
router.post("/charge", ...mw, async (req, res) => {
  try {
    const { provider, amount, description, patientName, patientEmail, patientCpf } = req.body;
    if (!provider || !amount || !description) {
      return res.status(400).json({ error: "Provider, valor e descrição são obrigatórios" });
    }

    const gw = await prisma.paymentGateway.findFirst({
      where: { userId: req.user.id, provider, active: true },
    });
    if (!gw) return res.status(400).json({ error: "Gateway não configurado ou inativo" });

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    // ── Mercado Pago ───────────────────────────────────────────
    if (provider === "mercadopago") {
      const token = decrypt(gw.apiKeyEnc);
      if (!token) return res.status(400).json({ error: "Access token do Mercado Pago não configurado" });

      const bodyPayload = {
        items: [{ title: description, quantity: 1, unit_price: amountNum, currency_id: "BRL" }],
        payer: patientEmail ? { email: patientEmail, name: patientName || undefined } : undefined,
        auto_return: "approved",
        payment_methods: { excluded_payment_types: [], installments: 12 },
        statement_descriptor: "Calenio",
      };

      const response = await httpRequest(
        {
          hostname: "api.mercadopago.com",
          path:     "/checkout/preferences",
          method:   "POST",
          headers:  {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
          },
        },
        bodyPayload
      );

      if (response.status !== 201) {
        const msg = response.body?.message || "Erro no Mercado Pago";
        return res.status(502).json({ error: msg });
      }

      return res.json({
        provider: "mercadopago",
        chargeUrl: response.body.init_point,
        amount:    amountNum,
        description,
      });
    }

    // ── Asaas ──────────────────────────────────────────────────
    if (provider === "asaas") {
      const apiKey = decrypt(gw.apiKeyEnc);
      if (!apiKey) return res.status(400).json({ error: "API Key do Asaas não configurada" });

      // Determina ambiente (sandbox vs produção) pela chave
      const isSandbox = apiKey.startsWith("$aact_") && apiKey.includes("_sandbox_");
      const asaasHost = isSandbox ? "sandbox.asaas.com" : "api.asaas.com";

      // Primeiro cria o cliente no Asaas (ou encontra pelo CPF/email)
      const custPayload = {
        name:          patientName  || "Paciente",
        email:         patientEmail || undefined,
        cpfCnpj:       patientCpf   ? patientCpf.replace(/\D/g, "") : undefined,
        externalReference: req.user.id,
      };

      const custResp = await httpRequest(
        {
          hostname: asaasHost,
          path:     "/api/v3/customers",
          method:   "POST",
          headers:  { "Content-Type": "application/json", "access_token": apiKey },
        },
        custPayload
      );

      const customerId = custResp.body?.id;
      if (!customerId) {
        const errMsg = custResp.body?.errors?.[0]?.description || "Erro ao criar cliente no Asaas";
        return res.status(502).json({ error: errMsg });
      }

      // Calcula data de vencimento (hoje + 3 dias)
      const due = new Date();
      due.setDate(due.getDate() + 3);
      const dueDate = due.toISOString().split("T")[0];

      const payPayload = {
        customer:    customerId,
        billingType: "PIX",
        value:       amountNum,
        dueDate,
        description,
        externalReference: req.user.id,
      };

      const payResp = await httpRequest(
        {
          hostname: asaasHost,
          path:     "/api/v3/payments",
          method:   "POST",
          headers:  { "Content-Type": "application/json", "access_token": apiKey },
        },
        payPayload
      );

      if (!payResp.body?.id) {
        const errMsg = payResp.body?.errors?.[0]?.description || "Erro ao criar cobrança no Asaas";
        return res.status(502).json({ error: errMsg });
      }

      return res.json({
        provider:    "asaas",
        chargeUrl:   payResp.body.invoiceUrl || payResp.body.bankSlipUrl || null,
        chargeId:    payResp.body.id,
        amount:      amountNum,
        description,
        dueDate,
      });
    }

    // ── PIX Manual ─────────────────────────────────────────────
    if (provider === "pix_manual") {
      if (!gw.pixKey) return res.status(400).json({ error: "Chave PIX não configurada" });

      const pixTypeLabel = {
        cpf:       "CPF",
        cnpj:      "CNPJ",
        email:     "E-mail",
        telefone:  "Telefone",
        aleatoria: "Chave aleatória",
      }[gw.pixKeyType] || "Chave PIX";

      const instructions = [
        `💰 Pagamento via PIX`,
        ``,
        `Beneficiário: ${gw.holderName || req.user.name}`,
        `${pixTypeLabel}: ${gw.pixKey}`,
        `Valor: R$ ${amountNum.toFixed(2).replace(".", ",")}`,
        `Descrição: ${description}`,
      ].join("\n");

      return res.json({
        provider:     "pix_manual",
        pixKey:       gw.pixKey,
        pixKeyType:   gw.pixKeyType,
        holderName:   gw.holderName || req.user.name,
        amount:       amountNum,
        description,
        instructions,
      });
    }

    res.status(400).json({ error: "Provider não suportado" });
  } catch (err) {
    console.error("payments/charge POST:", err);
    res.status(500).json({ error: "Erro ao gerar cobrança" });
  }
});

module.exports = router;
