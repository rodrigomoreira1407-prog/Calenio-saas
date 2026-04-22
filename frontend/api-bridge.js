// ============================================================
// CALENIO — PONTE FRONTEND → BACKEND
// Cole este bloco dentro do <script> do calenio.html
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
const API_URL = "https://calenio-api.onrender.com/api"; // produção
// const API_URL = "http://localhost:3001/api"; // desenvolvimento local

// ── ESTADO GLOBAL ───────────────────────────────────────────
let _token = localStorage.getItem("calenio_token");
let _user  = JSON.parse(localStorage.getItem("calenio_user") || "null");

// ── HELPER UNIVERSAL ────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (_token) opts.headers["Authorization"] = "Bearer " + _token;
  if (body)   opts.body = JSON.stringify(body);

  let data = {};
  try {
    const res = await fetch(API_URL + path, opts);
    data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      if (data.code === "TOKEN_EXPIRED") { logout(); return null; }
      return null;
    }
    if (res.status === 403) {
      if (data.code === "PLAN_BLOCKED" || data.code === "TRIAL_EXPIRED") {
        toast("⚠️ " + data.error);
        setTimeout(() => showScreen("plans"), 1500);
        return null;
      }
      if (data.code === "PLAN_INSUFFICIENT") {
        toast("🔒 " + data.error);
        return null;
      }
    }
    if (!res.ok) {
      toast("❌ " + (data.error || "Erro desconhecido"));
      return null;
    }
    return data;
  } catch (err) {
    toast("📡 Sem conexão com o servidor");
    return null;
  }
}

// ── AUTH ─────────────────────────────────────────────────────
function setAuth(token, user) {
  _token = token;
  _user  = user;
  localStorage.setItem("calenio_token", token);
  localStorage.setItem("calenio_user", JSON.stringify(user));
}

function logout() {
  _token = null;
  _user  = null;
  localStorage.removeItem("calenio_token");
  localStorage.removeItem("calenio_user");
  showScreen("login");
}

async function init() {
  if (!_token) { showScreen("login"); return; }
  const user = await api("GET", "/auth/me");
  if (!user) { showScreen("login"); return; }
  _user = user;
  showScreen("app");
  loadDashboard();
}

// ── FUNÇÕES DE AUTH ──────────────────────────────────────────
async function doLogin(email, password) {
  const data = await api("POST", "/auth/login", { email, password });
  if (!data) return;
  setAuth(data.token, data.user);
  updateUserUI(data.user);
  showScreen("app");
  loadDashboard();
  toast("✓ Bem-vindo(a), " + data.user.name.split(" ")[0] + "!");
}

async function doRegister(name, email, password, crp) {
  const data = await api("POST", "/auth/register", { name, email, password, crp });
  if (!data) return;
  toast("✓ Conta criada! Verifique seu e-mail.");
  showScreen("login");
}

async function doForgotPassword(email) {
  const data = await api("POST", "/auth/forgot-password", { email });
  if (data) toast("✓ E-mail de recuperação enviado!");
}

async function doResetPassword(token, password) {
  const data = await api("POST", "/auth/reset-password", { token, password });
  if (data) { toast("✓ Senha redefinida!"); showScreen("login"); }
}

// ── PACIENTES ────────────────────────────────────────────────
async function loadPatients(search, type, status) {
  const params = new URLSearchParams();
  if (search) params.append("search", search);
  if (type)   params.append("type", type);
  if (status) params.append("status", status);
  const data = await api("GET", "/patients?" + params);
  if (data) renderPatients(data);
}

async function createPatient(patientData) {
  const data = await api("POST", "/patients", patientData);
  if (data) { toast("✓ Paciente cadastrado!"); closeM("m-npat"); loadPatients(); }
}

async function updatePatient(id, patientData) {
  const data = await api("PUT", "/patients/" + id, patientData);
  if (data) { toast("✓ Cadastro atualizado!"); closeM("m-npat"); loadPatients(); }
}

// ── AGENDA ───────────────────────────────────────────────────
async function loadAppointments(from, to, status) {
  const params = new URLSearchParams();
  if (from)   params.append("from", from);
  if (to)     params.append("to", to);
  if (status) params.append("status", status);
  const data = await api("GET", "/appointments?" + params);
  if (data) renderCalendar(data);
}

async function createAppointment(apptData) {
  const data = await api("POST", "/appointments", apptData);
  if (data) {
    toast("✓ Sessão agendada!" + (data.meetLink ? " 🎥 Meet gerado!" : ""));
    closeM("m-appt");
    loadAppointments();
  }
}

async function setAppointmentStatus(id, status, value) {
  const data = await api("PATCH", "/appointments/" + id + "/status", { status, value });
  if (data) {
    const msgs = { COMPLETED: "✓ Sessão concluída!", CANCELLED: "✗ Sessão cancelada", NO_SHOW: "⚠️ Falta registrada" };
    toast(msgs[status] || "✓ Status atualizado");
    loadAppointments();
    loadPending();
  }
}

async function loadPending() {
  const data = await api("GET", "/appointments/pending");
  if (data) {
    renderPending(data);
    const badge = document.getElementById("sess-badge");
    if (badge) {
      badge.textContent = data.length;
      badge.classList.toggle("hidden", data.length === 0);
    }
  }
}

// ── PRONTUÁRIOS / EVOLUÇÕES ──────────────────────────────────
async function loadRecords(patientId) {
  const data = await api("GET", "/records?patientId=" + patientId);
  if (data) renderRecords(data);
}

async function createRecord(recordData) {
  const data = await api("POST", "/records", recordData);
  if (data) { toast("✓ Evolução salva!"); closeM("m-rec"); loadRecords(recordData.patientId); }
}

// ── IA (via backend — chave protegida) ──────────────────────
async function callAI() {
  const content = document.getElementById("rc")?.value?.trim();
  if (!content || content.length < 15) { toast("⚠️ Descreva o conteúdo da sessão"); return; }

  document.getElementById("ai-load")?.classList?.remove("hidden");
  document.getElementById("ai-res")?.classList?.add("hidden");

  const data = await api("POST", "/ai/generate-record", { content });

  document.getElementById("ai-load")?.classList?.add("hidden");
  if (data?.text) {
    const el = document.getElementById("ai-txt");
    if (el) el.textContent = data.text;
    document.getElementById("ai-res")?.classList?.remove("hidden");
    toast("🤖 Prontuário gerado!");
  }
}

// ── FINANCEIRO ───────────────────────────────────────────────
async function loadFinancial(from, to, category) {
  const params = new URLSearchParams();
  if (from)     params.append("from", from);
  if (to)       params.append("to", to);
  if (category) params.append("category", category);
  const data = await api("GET", "/financial?" + params);
  if (data) renderFinancial(data);
}

async function payFinancialItem(id) {
  const data = await api("PATCH", "/financial/" + id + "/pay");
  if (data) { toast("✓ Marcado como pago!"); loadFinancial(); }
}

async function loadContadorReport(month, year) {
  const params = new URLSearchParams({ month, year });
  const data = await api("GET", "/financial/report/contador?" + params);
  if (data) renderContadorReport(data);
}

// ── ASSINATURA ───────────────────────────────────────────────
async function startCheckout(plan, billing) {
  const data = await api("POST", "/subscriptions/checkout", { plan, billing });
  if (data?.url) window.location.href = data.url;
}

async function openBillingPortal() {
  const data = await api("POST", "/subscriptions/portal");
  if (data?.url) window.open(data.url, "_blank");
}

async function loadSubscriptionStatus() {
  const data = await api("GET", "/subscriptions/status");
  if (data) updateSubscriptionUI(data);
}

// ── CONVÊNIOS ────────────────────────────────────────────────
async function loadConvenios() {
  const data = await api("GET", "/convenios");
  if (data) {
    // Atualiza select de convênios no modal de agendamento
    const sel = document.getElementById("appt-pagto");
    if (sel) {
      const baseOpts = '<option value="particular">Particular</option><option value="teste">Aplicação de Teste</option>';
      const convOpts = data.map(c =>
        `<option value="${c.id}">Convênio — ${c.name} (R$ ${c.value.toFixed(2)})</option>`
      ).join("");
      sel.innerHTML = baseOpts + convOpts;
    }
  }
  return data;
}

async function saveConvenioAPI(convData) {
  const data = await api("POST", "/convenios", convData);
  if (data) { toast("🏥 Convênio cadastrado!"); closeM("m-conv"); loadConvenios(); }
}

// ── ATUALIZA UI DO USUÁRIO ───────────────────────────────────
function updateUserUI(user) {
  const nameEl = document.querySelector(".uname");
  const planEl = document.querySelector(".uplan");
  const avEl   = document.querySelector(".uav");
  if (nameEl) nameEl.textContent = user.name;
  if (avEl)   avEl.textContent   = user.name.charAt(0).toUpperCase();
  if (planEl) {
    const planMap = { PRO: "PRO+IA Ativo", BASIC: "Basic Ativo", FREE: "Trial" };
    planEl.textContent = "● " + (planMap[user.plan] || user.planStatus);
    planEl.style.color = user.plan === "PRO" ? "#27ae60" : user.plan === "BASIC" ? "#46b0b3" : "#e67e22";
  }
}

function updateSubscriptionUI(status) {
  const { plan, planStatus, trialDaysLeft } = status;
  if (planStatus === "TRIAL" && trialDaysLeft <= 3) {
    toast(`⏰ Trial acaba em ${trialDaysLeft} dia(s). Assine um plano!`);
  }
}

// ── STUBS (implemente conforme o HTML atual) ─────────────────
function renderPatients(data) { /* sua função de render atual */ }
function renderCalendar(data) { /* sua função de render atual */ }
function renderPending(data)  { /* sua função de render atual */ }
function renderRecords(data)  { /* sua função de render atual */ }
function renderFinancial(data){ /* sua função de render atual */ }
function renderContadorReport(data) { /* sua função de render atual */ }
function showScreen(name) { /* sua função de trocar tela */ }
function updateUserUI(user) { /* atualiza nome/plano no sidebar */ }
function loadDashboard() { /* carrega dados do dashboard */ }

// ── INICIALIZAR ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);