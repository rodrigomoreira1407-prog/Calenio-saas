const express = require("express");
const router  = express.Router();
const { auth, requireActivePlan } = require("../middleware/auth");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const mw = [auth, requireActivePlan];

// Listar sessões com filtros
router.get("/", ...mw, async (req, res) => {
  try {
    const { status, from, to, patientId } = req.query;
    const where = { userId: req.user.id };
    if (status)    where.status    = status;
    if (patientId) where.patientId = patientId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to)   where.date.lte = new Date(to);
    }
    const appts = await prisma.appointment.findMany({
      where, orderBy: { date: "desc" },
      include: { patient: { select: { id:true, name:true, type:true, phone:true } } },
    });
    res.json(appts);
  } catch (err) { res.status(500).json({ error: "Erro ao listar sessões" }); }
});

// Criar sessão
router.post("/", ...mw, async (req, res) => {
  try {
    const { patientId, date, duration, type, value, title, convenioId, paymentType } = req.body;
    if (!patientId || !date) return res.status(400).json({ error: "Paciente e data são obrigatórios" });

    // Verificar se paciente pertence ao psicólogo
    const patient = await prisma.patient.findFirst({ where: { id: patientId, userId: req.user.id } });
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado" });

    // Gerar link Google Meet automático (placeholder — integrar com Google API em v2)
    const meetLink = type === "ONLINE"
      ? `https://meet.google.com/${Math.random().toString(36).slice(2,5)}-${Math.random().toString(36).slice(2,6)}-${Math.random().toString(36).slice(2,5)}`
      : null;

    const appt = await prisma.appointment.create({
      data: {
        userId: req.user.id, patientId, title: title || "Consulta",
        date: new Date(date), duration: duration || 50,
        type: type || "ONLINE", value: parseFloat(value) || 0,
        meetLink, convenioId, paymentType: paymentType || "particular",
      },
      include: { patient: { select: { id:true, name:true, phone:true } } },
    });
    res.status(201).json(appt);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar sessão" });
  }
});

// Atualizar status (concluir, cancelar, falta)
router.patch("/:id/status", ...mw, async (req, res) => {
  try {
    const { status, value } = req.body;
    const valid = ["CONFIRMED","COMPLETED","CANCELLED","NO_SHOW","PENDING"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Status inválido" });

    const appt = await prisma.appointment.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!appt) return res.status(404).json({ error: "Sessão não encontrada" });

    const data = { status };
    if (status === "CONFIRMED") data.confirmedAt = new Date();
    if (value !== undefined) data.value = parseFloat(value);

    const updated = await prisma.appointment.update({ where: { id: req.params.id }, data });

    // Criar lançamento financeiro automático ao concluir
    if (status === "COMPLETED") {
      await prisma.financial.create({
        data: {
          userId: req.user.id, patientId: appt.patientId,
          type: "INCOME", category: appt.paymentType,
          description: `Sessão — ${appt.title}`,
          value: updated.value, date: appt.date,
          status: "PENDING",
        },
      });
    }

    res.json(updated);
  } catch (err) { res.status(500).json({ error: "Erro ao atualizar sessão" }); }
});

// Deletar
router.delete("/:id", ...mw, async (req, res) => {
  try {
    const appt = await prisma.appointment.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!appt) return res.status(404).json({ error: "Sessão não encontrada" });
    await prisma.appointment.delete({ where: { id: req.params.id } });
    res.json({ message: "Sessão excluída" });
  } catch (err) { res.status(500).json({ error: "Erro ao excluir sessão" }); }
});

// Sessões pendentes (sem ação após a data)
router.get("/pending", ...mw, async (req, res) => {
  try {
    const pending = await prisma.appointment.findMany({
      where: {
        userId: req.user.id,
        status: "SCHEDULED",
        date: { lt: new Date() },
      },
      include: { patient: { select: { id:true, name:true } } },
      orderBy: { date: "desc" },
    });
    res.json(pending);
  } catch (err) { res.status(500).json({ error: "Erro ao buscar pendentes" }); }
});

// Confirmar presença (link do WhatsApp/e-mail)
router.get("/confirm/:id", async (req, res) => {
  try {
    const appt = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appt) return res.status(404).json({ error: "Sessão não encontrada" });
    await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    res.json({ message: "Presença confirmada! Até logo." });
  } catch (err) { res.status(500).json({ error: "Erro ao confirmar" }); }
});

module.exports = router;
