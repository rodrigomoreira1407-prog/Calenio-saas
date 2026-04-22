const express = require("express");
const router  = express.Router();
const { auth, requireActivePlan, requirePlan } = require("../middleware/auth");

// Geração de prontuário com IA (apenas plano PRO)
router.post("/generate-record", auth, requireActivePlan, requirePlan("PRO"), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || content.length < 15) {
      return res.status(400).json({ error: "Descreva o conteúdo da sessão" });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "IA não configurada" });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: "Você é um assistente especializado em psicologia clínica. Transforme anotações informais de sessões em prontuários clínicos estruturados e profissionais em português do Brasil. Estruture com: 1. RELATO DA SESSÃO  2. INTERVENÇÕES REALIZADAS  3. EVOLUÇÃO OBSERVADA  4. ENCAMINHAMENTOS E TAREFAS. Máximo 300 palavras.",
        messages: [{ role: "user", content: `Gere um prontuário clínico com base nestas notas: "${content}"` }],
      }),
    });

    const data = await response.json();
    if (data.content?.[0]?.text) {
      res.json({ text: data.content[0].text });
    } else {
      res.status(500).json({ error: "Erro na geração do prontuário" });
    }
  } catch (err) {
    console.error("AI error:", err);
    res.status(500).json({ error: "Erro ao chamar IA" });
  }
});

module.exports = router;