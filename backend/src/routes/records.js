const express = require("express");
const router  = express.Router();
const { auth, requireActivePlan, requirePlan } = require("../middleware/auth");
const { encrypt, decrypt } = require("../utils/crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const mw = [auth, requireActivePlan];

// Listar evoluções de um paciente
router.get("/", ...mw, async (req, res) => {
  try {
    const { patientId, from, to } = req.query;
    if (!patientId) return res.status(400).json({ error: "patientId é obrigatório" });

    const where = { userId: req.user.id, patientId };
    if (from || to) {
      where.sessionDate = {};
      if (from) where.sessionDate.gte = new Date(from);
      if (to)   where.sessionDate.lte = new Date(to);
    }

    const records = await prisma.record.findMany({
      where, orderBy: { sessionDate: "desc" },
      select: {
        id:true, sessionDate:true, sessionNum:true, aiGenerated:true,
        techniques:true, evolution:true, goals:true, risks:true,
        contentEncrypted:true, createdAt:true,
      },
    });

    // Descriptografa conteúdo
    const decrypted = records.map(r => ({
      ...r,
      content: decrypt(r.contentEncrypted) || "",
      contentEncrypted: undefined,
    }));

    res.json(decrypted);
  } catch (err) { res.status(500).json({ error: "Erro ao listar evoluções" }); }
});

// Criar evolução
router.post("/", ...mw, async (req, res) => {
  try {
    const { patientId, content, techniques, evolution, goals, risks, aiGenerated, sessionDate } = req.body;
    if (!patientId || !content) return res.status(400).json({ error: "Paciente e conteúdo são obrigatórios" });

    const patient = await prisma.patient.findFirst({ where: { id: patientId, userId: req.user.id } });
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado" });

    // Conta sessões para numerar
    const count = await prisma.record.count({ where: { userId: req.user.id, patientId } });

    const record = await prisma.record.create({
      data: {
        userId: req.user.id, patientId,
        contentEncrypted: encrypt(content),  // LGPD: criptografado
        techniques, evolution, goals, risks,
        aiGenerated: Boolean(aiGenerated),
        sessionNum: count + 1,
        sessionDate: sessionDate ? new Date(sessionDate) : new Date(),
      },
    });

    res.status(201).json({ ...record, content, contentEncrypted: undefined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao salvar evolução" });
  }
});

// Atualizar evolução
router.put("/:id", ...mw, async (req, res) => {
  try {
    const rec = await prisma.record.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!rec) return res.status(404).json({ error: "Evolução não encontrada" });

    const { content, techniques, evolution, goals, risks } = req.body;
    const data = { techniques, evolution, goals, risks };
    if (content) data.contentEncrypted = encrypt(content);

    const updated = await prisma.record.update({ where: { id: req.params.id }, data });
    res.json({ ...updated, content: content || decrypt(updated.contentEncrypted), contentEncrypted: undefined });
  } catch (err) { res.status(500).json({ error: "Erro ao atualizar evolução" }); }
});

// Deletar
router.delete("/:id", ...mw, async (req, res) => {
  try {
    const rec = await prisma.record.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!rec) return res.status(404).json({ error: "Evolução não encontrada" });
    await prisma.record.delete({ where: { id: req.params.id } });
    res.json({ message: "Evolução excluída" });
  } catch (err) { res.status(500).json({ error: "Erro ao excluir evolução" }); }
});

module.exports = router;