const express = require("express");
const router  = express.Router();
const { auth, requireActivePlan } = require("../middleware/auth");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();
const mw = [auth, requireActivePlan];

// Listar sessões
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

    const patient = await prisma.patient.findFirst({ where: { id: patientId, userId: req.user.id } });
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado" });

    // Link Jitsi automático
    const room = "calenio-" +
      patient.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"-").slice(0,20) +
      "-" + crypto.randomBytes(4).toString("hex");
    const meetLink = type === "ONLINE" ? "https://meet.jit.si/" + room : null;

    // Dados base — sem confirmToken por enquanto (campo pode não existir no banco)
    const data = {
      userId: req.user.id, patientId,
      title: title || "Consulta",
      date: new Date(date),
      duration: duration || 50,
      type: type || "ONLINE",
      value: parseFloat(value) || 0,
      meetLink,
      paymentType: paymentType || "particular",
    };
    if (convenioId) data.convenioId = convenioId;

    // Tenta adicionar confirmToken se o campo existir no banco
    try {
      const token = crypto.randomBytes(12).toString("hex");
      const appt = await prisma.appointment.create({
        data: { ...data, confirmToken: token },
        include: { patient: { select: { id:true, name:true, phone:true } } },
      });
      return res.status(201).json(appt);
    } catch (tokenErr) {
      // Campo confirmToken não existe no banco — cria sem ele
      if (tokenErr.code === "P2009" || tokenErr.message.includes("confirmToken") || tokenErr.message.includes("Unknown field")) {
        const appt = await prisma.appointment.create({
          data,
          include: { patient: { select: { id:true, name:true, phone:true } } },
        });
        return res.status(201).json(appt);
      }
      throw tokenErr;
    }
  } catch (err) {
    console.error("Erro ao criar sessão:", err.message);
    res.status(500).json({ error: "Erro ao criar sessão: " + err.message });
  }
});

// Editar sessão
router.put("/:id", ...mw, async (req, res) => {
  try {
    const appt = await prisma.appointment.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!appt) return res.status(404).json({ error: "Sessão não encontrada" });
    const { date, value, type, duration } = req.body;
    const data = {};
    if (date)     data.date     = new Date(date);
    if (value !== undefined) data.value = parseFloat(value);
    if (type)     data.type     = type;
    if (duration) data.duration = parseInt(duration);
    const updated = await prisma.appointment.update({
      where: { id: req.params.id }, data,
      include: { patient: { select: { id:true, name:true, phone:true } } },
    });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: "Erro ao editar sessão" }); }
});

// Atualizar status
router.patch("/:id/status", ...mw, async (req, res) => {
  try {
    const { status, value } = req.body;
    const valid = ["CONFIRMED","COMPLETED","CANCELLED","NO_SHOW","PENDING","SCHEDULED"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Status inválido" });

    const appt = await prisma.appointment.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!appt) return res.status(404).json({ error: "Sessão não encontrada" });

    const data = { status };
    if (status === "CONFIRMED") data.confirmedAt = new Date();
    if (value !== undefined) data.value = parseFloat(value);

    const updated = await prisma.appointment.update({ where: { id: req.params.id }, data });

    if (status === "COMPLETED") {
      await prisma.financial.create({
        data: {
          userId: req.user.id, patientId: appt.patientId,
          type: "INCOME", category: appt.paymentType || "particular",
          description: "Sessão — " + (appt.title || "Consulta"),
          value: updated.value, date: appt.date, status: "PENDING",
        },
      }).catch(function(){});
    }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: "Erro ao atualizar sessão" }); }
});

// Confirmação pública por token
router.get("/confirm/:token", async (req, res) => {
  try {
    const appt = await prisma.appointment.findFirst({
      where: { confirmToken: req.params.token },
      include: { patient: { select: { name:true } } },
    }).catch(function(){ return null; });
    if (!appt) return res.status(404).json({ error: "Link inválido ou expirado" });
    const d = new Date(appt.date);
    res.json({
      id: appt.id, patientName: appt.patient ? appt.patient.name : "",
      date: d.getDate()+"/"+(d.getMonth()+1)+"/"+d.getFullYear(),
      time: String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"),
      type: appt.type, meetLink: appt.meetLink, status: appt.status,
    });
  } catch (err) { res.status(500).json({ error: "Erro ao buscar sessão" }); }
});

router.patch("/confirm/:token", async (req, res) => {
  try {
    const { action } = req.body;
    const appt = await prisma.appointment.findFirst({ where: { confirmToken: req.params.token } }).catch(function(){ return null; });
    if (!appt) return res.status(404).json({ error: "Link inválido" });
    const status = action === "cancel" ? "CANCELLED" : "CONFIRMED";
    const data = { status };
    if (status === "CONFIRMED") data.confirmedAt = new Date();
    await prisma.appointment.update({ where: { id: appt.id }, data });
    res.json({ message: status === "CONFIRMED" ? "Presença confirmada!" : "Sessão cancelada." });
  } catch (err) { res.status(500).json({ error: "Erro ao confirmar" }); }
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

module.exports = router;
