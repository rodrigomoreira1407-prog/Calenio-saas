const express = require("express");
const router  = express.Router();
const { auth, requireActivePlan } = require("../middleware/auth");
const { encrypt, decrypt } = require("../utils/crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const mw = [auth, requireActivePlan];

// Listar pacientes
router.get("/", ...mw, async (req, res) => {
  try {
    const { search, type, status } = req.query;
    const where = { userId: req.user.id };
    if (type)   where.type   = type;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { cpf:  { contains: search } },
        { phone:{ contains: search } },
        { email:{ contains: search, mode: "insensitive" } },
      ];
    }
    const patients = await prisma.patient.findMany({
      where, orderBy: { createdAt: "desc" },
      select: {
        id:true, name:true, type:true, status:true, phone:true, email:true,
        cpf:true, birthDate:true, emergName:true, emergPhone:true,
        resp1Name:true, resp1Phone:true, resp1Relation:true, createdAt:true,
        _count: { select: { appointments:true, records:true } },
      },
    });
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: "Erro ao listar pacientes" });
  }
});

// Buscar paciente por ID
router.get("/:id", ...mw, async (req, res) => {
  try {
    const patient = await prisma.patient.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { _count: { select: { appointments:true, records:true } } },
    });
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado" });

    // Descriptografa anamnese se existir
    if (patient.anamneseData) {
      try { patient.anamneseData = JSON.parse(decrypt(patient.anamneseData) || "{}"); }
      catch(e) { patient.anamneseData = {}; }
    }
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar paciente" });
  }
});

// Criar paciente
router.post("/", ...mw, async (req, res) => {
  try {
    const { anamneseData, ...rest } = req.body;
    const data = { ...rest, userId: req.user.id };

    // Criptografa anamnese (LGPD)
    if (anamneseData) {
      data.anamneseData = encrypt(JSON.stringify(anamneseData));
    }

    const patient = await prisma.patient.create({ data });
    res.status(201).json(patient);
  } catch (err) {
    console.error("Create patient error:", err);
    res.status(500).json({ error: "Erro ao criar paciente" });
  }
});

// Atualizar paciente
router.put("/:id", ...mw, async (req, res) => {
  try {
    const exists = await prisma.patient.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!exists) return res.status(404).json({ error: "Paciente não encontrado" });

    const { anamneseData, ...rest } = req.body;
    const data = { ...rest };
    if (anamneseData) data.anamneseData = encrypt(JSON.stringify(anamneseData));

    const patient = await prisma.patient.update({ where: { id: req.params.id }, data });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar paciente" });
  }
});

// Excluir paciente
router.delete("/:id", ...mw, async (req, res) => {
  try {
    const exists = await prisma.patient.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!exists) return res.status(404).json({ error: "Paciente não encontrado" });
    await prisma.patient.delete({ where: { id: req.params.id } });
    res.json({ message: "Paciente excluído" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir paciente" });
  }
});

module.exports = router;