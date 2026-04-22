# 🌙 Calenio SaaS — Guia Técnico de Migração
**Arquiteto: Claude Sonnet | Stack: Node.js + PostgreSQL + Stripe**
**Versão: 1.0.0**

---

## 🗺️ VISÃO GERAL DA ARQUITETURA

```
┌─────────────────────────────────────────────────────┐
│                USUÁRIO (Psicólogo)                   │
└─────────────────────┬───────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────┐
│          FRONTEND  (Netlify — gratuito)              │
│     calenio.html  +  api-bridge.js                  │
│     Chama API com JWT no header Authorization       │
└─────────────────────┬───────────────────────────────┘
                      │ REST / JSON
┌─────────────────────▼───────────────────────────────┐
│         BACKEND  (Render.com — gratuito)             │
│         Node.js  +  Express  +  Prisma ORM          │
│                                                      │
│  /api/auth/*          → Cadastro, login, JWT        │
│  /api/patients/*      → Pacientes (multi-tenant)    │
│  /api/appointments/*  → Agenda + Meet link          │
│  /api/records/*       → Prontuários (AES-256)       │
│  /api/financial/*     → Financeiro + relatórios     │
│  /api/convenios/*     → Convênios                   │
│  /api/ai/*            → Claude API (chave segura)   │
│  /api/subscriptions/* → Stripe webhooks             │
│  /api/admin/*         → Dashboard admin             │
└──────────┬──────────────────────┬───────────────────┘
           │                      │
┌──────────▼──────────┐  ┌────────▼────────────────┐
│   PostgreSQL         │  │    Claude API            │
│  (Supabase — free)  │  │  (chave no servidor)     │
│  Multi-tenant       │  │  Prontuário por IA       │
│  AES-256 LGPD       │  └─────────────────────────┘
└─────────────────────┘
```

---

## 🛠️ STACK TECNOLÓGICA

| Camada | Escolha | Por quê |
|--------|---------|---------|
| Backend | Node.js + Express | Mesmo JS do frontend, ecossistema enorme |
| ORM | Prisma | Type-safe, migrations visuais, excelente DX |
| Banco | PostgreSQL no Supabase | Grátis até 500MB, painel visual |
| Auth | JWT HS256 | Stateless, funciona com HTML estático |
| Criptografia | AES-256-GCM | Prontuários cifrados no banco (LGPD) |
| Pagamentos | Stripe | Melhor UX br, webhooks confiáveis |
| Email | Nodemailer + Gmail | Zero custo no início |
| Deploy back | Render.com | Grátis, auto-deploy do GitHub |
| Deploy front | Netlify | CDN global, HTTPS automático |

---

## 📁 ESTRUTURA DE ARQUIVOS ENTREGUES

```
calenio-saas/
│
├── backend/
│   ├── prisma/
│   │   └── schema.prisma          ← 6 models: User, Patient, Appointment,
│   │                                 Record, Financial, Convenio
│   ├── src/
│   │   ├── server.js              ← Entry point Node.js
│   │   ├── app.js                 ← Express + CORS + rate limit + rotas
│   │   ├── controllers/
│   │   │   └── authController.js  ← register/login/verify/forgot/reset
│   │   ├── routes/
│   │   │   ├── auth.js            ← POST /login, /register, GET /me
│   │   │   ├── patients.js        ← CRUD pacientes (anamnese cifrada)
│   │   │   ├── appointments.js    ← CRUD agenda + /pending + /confirm
│   │   │   ├── records.js         ← CRUD evoluções (AES-256)
│   │   │   ├── financial.js       ← CRUD financeiro + /report/contador
│   │   │   ├── convenios.js       ← CRUD convênios
│   │   │   ├── subscriptions.js   ← Stripe checkout + webhooks + portal
│   │   │   ├── ai.js              ← Claude API protegida no servidor
│   │   │   └── admin.js           ← Métricas + gestão de usuários
│   │   ├── middleware/
│   │   │   └── auth.js            ← JWT + requireActivePlan + requirePlan
│   │   ├── services/
│   │   │   └── email.js           ← Templates: boas-vindas, verificação,
│   │   │                              reset, lembrete de consulta
│   │   └── utils/
│   │       └── crypto.js          ← encrypt/decrypt AES-256-GCM (LGPD)
│   ├── .env.example               ← Todas as variáveis de ambiente
│   ├── package.json
│   └── render.yaml                ← Deploy automático no Render
│
├── frontend/
│   └── api-bridge.js              ← Cola no calenio.html — ponte completa
│                                     com todas as funções de API
└── GUIA_TECNICO.md                ← Este arquivo
```

---

## 🔐 MULTI-TENANCY E LGPD

### Isolamento de dados (Multi-tenant)
Cada psicólogo é um tenant. **Todo model tem `userId`** e o middleware
injeta `req.user` — nenhuma query retorna dados de outro usuário:

```javascript
// Middleware: injeta o usuário autenticado
const user = await prisma.user.findUnique({ where: { id: decoded.id } });
req.user = user;

// Todas as queries filtram por userId automaticamente
const patients = await prisma.patient.findMany({
  where: { userId: req.user.id }  // ← isolamento garantido
});
```

### Criptografia AES-256-GCM (LGPD)
Prontuários e anamneses são **criptografados antes de salvar**:

```
Texto plano  →  AES-256-GCM  →  IV:TAG:CIPHERTEXT (base64)
```

Gere sua chave de 32 bytes:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🚀 DEPLOY EM 6 PASSOS

### PASSO 1 — Banco de Dados (Supabase — GRÁTIS)
1. [supabase.com](https://supabase.com) → New Project → guarde a senha
2. Settings → Database → Connection String → URI
3. Cole em `DATABASE_URL` no `.env`

### PASSO 2 — Push para GitHub
```bash
cd calenio-saas
git init
git add .
git commit -m "feat: Calenio SaaS v1.0"
git remote add origin https://github.com/SEU-USUARIO/calenio-backend.git
git push -u origin main
```

### PASSO 3 — Backend no Render.com (GRÁTIS)
1. [render.com](https://render.com) → New → Web Service
2. Conecte o repositório GitHub
3. Root Directory: `backend`
4. Build: `npm install && npx prisma generate && npx prisma db push`
5. Start: `npm start`
6. Adicione todas as variáveis do `.env.example`
7. Copie a URL gerada (ex: `https://calenio-api.onrender.com`)

### PASSO 4 — Frontend no Netlify (GRÁTIS)
1. Edite `calenio.html`:
```javascript
const API_URL = "https://calenio-api.onrender.com/api";
```
2. Cole o conteúdo de `api-bridge.js` dentro do `<script>` do `calenio.html`
3. [netlify.com/drop](https://app.netlify.com/drop) → arraste a pasta

### PASSO 5 — Stripe (Pagamentos)
1. [stripe.com](https://stripe.com) → Products → criar 2:
   - **Calenio Basic**: R$ 29,90/mês
   - **Calenio PRO+IA**: R$ 59,90/mês
2. Copie os `Price IDs` para as variáveis `STRIPE_PRICE_*`
3. Webhooks → Add endpoint:
   - URL: `https://calenio-api.onrender.com/api/subscriptions/webhook`
   - Eventos: `checkout.session.completed`, `invoice.payment_failed`,
     `invoice.payment_succeeded`, `customer.subscription.deleted`
4. Copie o Webhook Secret → `STRIPE_WEBHOOK_SECRET`

### PASSO 6 — E-mail Gmail
1. [myaccount.google.com](https://myaccount.google.com) → Segurança
2. Verificação em duas etapas → Senhas de app → criar para "Calenio"
3. Cole em `EMAIL_USER` (seu gmail) e `EMAIL_PASS` (senha gerada)

---

## 💰 MODELO DE RECEITA

| Plano | Preço/mês | IA | Trial |
|-------|-----------|----|----- |
| Basic | R$ 29,90 | ❌ | 14 dias |
| PRO + IA | R$ 59,90 | ✅ | 14 dias |

**Projeções:**
- 50 assinantes Basic + 50 PRO = **R$ 4.495/mês**
- 200 Basic + 100 PRO = **R$ 11.970/mês**

**Bloqueio por inadimplência:** ao falhar o pagamento, Stripe dispara
`invoice.payment_failed` → webhook atualiza `planStatus = PAST_DUE` →
middleware retorna `403 PLAN_BLOCKED` → frontend redireciona para `/plans`.

---

## 🧪 TESTAR LOCALMENTE

```bash
# Terminal 1 — Backend
cd calenio-saas/backend
npm install
cp .env.example .env          # preencha as variáveis
npx prisma db push            # cria as tabelas
npm run dev                   # inicia em :3001

# Terminal 2 — Frontend
# Abra calenio.html no Chrome
# Altere API_URL para http://localhost:3001/api
```

---

## 📊 ENDPOINTS DISPONÍVEIS

```
AUTH
  POST   /api/auth/register
  POST   /api/auth/login
  GET    /api/auth/me                  (JWT)
  PUT    /api/auth/profile             (JWT)
  PUT    /api/auth/password            (JWT)
  POST   /api/auth/forgot-password
  POST   /api/auth/reset-password
  GET    /api/auth/verify/:token

PACIENTES
  GET    /api/patients                 filtros: search, type, status
  GET    /api/patients/:id
  POST   /api/patients
  PUT    /api/patients/:id
  DELETE /api/patients/:id

AGENDA
  GET    /api/appointments             filtros: status, from, to
  POST   /api/appointments
  PATCH  /api/appointments/:id/status  COMPLETED|CANCELLED|NO_SHOW
  DELETE /api/appointments/:id
  GET    /api/appointments/pending     sessões sem ação após data
  GET    /api/appointments/confirm/:id link de confirmação (WhatsApp)

PRONTUÁRIOS
  GET    /api/records?patientId=       (descriptografado na resposta)
  POST   /api/records                  (criptografado antes de salvar)
  PUT    /api/records/:id
  DELETE /api/records/:id

FINANCEIRO
  GET    /api/financial                filtros: type, category, status
  POST   /api/financial
  PATCH  /api/financial/:id/pay
  DELETE /api/financial/:id
  GET    /api/financial/report/contador?month=&year=

CONVÊNIOS
  GET    /api/convenios
  POST   /api/convenios
  PUT    /api/convenios/:id
  DELETE /api/convenios/:id

IA (requer plano PRO)
  POST   /api/ai/generate-record       { content: "notas da sessão" }

ASSINATURAS
  POST   /api/subscriptions/checkout  { plan: "PRO", billing: "monthly" }
  GET    /api/subscriptions/status
  POST   /api/subscriptions/portal    (Stripe customer portal)
  POST   /api/subscriptions/webhook   (Stripe — raw body)

ADMIN (requer role ADMIN)
  GET    /api/admin/metrics
  GET    /api/admin/users
  PATCH  /api/admin/users/:id/plan
```

---

## 🔮 ROADMAP

| Versão | Feature |
|--------|---------|
| v1.0 | ✅ Auth + Planos + API completa |
| v1.1 | Tela de login/cadastro no calenio.html |
| v1.2 | Sync total pacientes/sessões com API |
| v1.3 | Google Calendar API real (Meet automático) |
| v2.0 | Dashboard Admin com métricas de MRR |
| v2.1 | App React Native (iOS + Android) |
| v2.2 | Multi-profissional por clínica |
| v2.3 | Relatórios PDF gerados no backend |
