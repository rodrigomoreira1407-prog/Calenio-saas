const nodemailer = require("nodemailer");

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  return transporter;
}

const base = (content) => `
<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:32px">
  <div style="background:linear-gradient(135deg,#46b0b3,#4b54a0);border-radius:14px;padding:22px;text-align:center;margin-bottom:24px">
    <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-.02em">🌙 Calenio</div>
    <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:4px">Sistema de Gestão Clínica</div>
  </div>
  ${content}
  <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:24px">© 2025 Calenio — Todos os direitos reservados</p>
</div>`;

async function sendVerificationEmail(email, name, token) {
  const url = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Confirme seu cadastro no Calenio 🌙",
    html: base(`
      <h2 style="font-size:20px;font-weight:700;color:#0d1b2a;margin-bottom:8px">Olá, ${name}!</h2>
      <p style="color:#475569;font-size:15px;line-height:1.7;margin-bottom:24px">Confirme seu e-mail para ativar sua conta e aproveitar os <strong>14 dias de trial gratuito</strong>.</p>
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#46b0b3,#4b54a0);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px">Confirmar e-mail →</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:20px">Link válido por 24 horas. Se não foi você, ignore.</p>
    `),
  });
}

async function sendPasswordResetEmail(email, name, token) {
  const url = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Redefinir senha — Calenio",
    html: base(`
      <h2 style="font-size:20px;font-weight:700;color:#0d1b2a;margin-bottom:8px">Redefinir senha</h2>
      <p style="color:#475569;font-size:15px;line-height:1.7;margin-bottom:24px">Olá ${name}, recebemos uma solicitação de redefinição de senha.</p>
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#46b0b3,#4b54a0);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700">Redefinir senha →</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:20px">Link válido por 1 hora. Se não foi você, ignore.</p>
    `),
  });
}

async function sendWelcomeEmail(email, name, plan) {
  const planName = plan === "PRO" ? "PRO + IA" : "Basic";
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `🎉 Bem-vindo ao Calenio! Plano ${planName} ativado`,
    html: base(`
      <h2 style="font-size:20px;font-weight:700;color:#0d1b2a;margin-bottom:8px">Bem-vindo, ${name}!</h2>
      <p style="color:#475569;font-size:15px;line-height:1.7;margin-bottom:24px">Seu plano <strong>${planName}</strong> foi ativado. Você tem acesso completo ao Calenio.</p>
      <a href="${process.env.FRONTEND_URL}" style="display:inline-block;background:linear-gradient(135deg,#46b0b3,#4b54a0);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700">Acessar o sistema →</a>
    `),
  });
}

async function sendReminderEmail(patientEmail, patientName, apptDate, confirmToken) {
  const url = `${process.env.FRONTEND_URL}/confirm/${confirmToken}`;
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: patientEmail,
    subject: "Lembrete da sua consulta 📋",
    html: base(`
      <h2 style="font-size:20px;font-weight:700;color:#0d1b2a;margin-bottom:8px">Olá, ${patientName}!</h2>
      <p style="color:#475569;font-size:15px;line-height:1.7;margin-bottom:16px">Sua consulta está agendada para <strong>${apptDate}</strong>.</p>
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#27ae60,#2ecc71);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px">✓ Confirmar presença</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px">Não consegue comparecer? Entre em contato.</p>
    `),
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail, sendReminderEmail };