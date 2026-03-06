# 🧠 LoomIQ — Multi-Agent AI Orchestration Platform

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen)](https://mind-forge-three.vercel.app/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-blue)](https://postgresql.org)
[![Railway](https://img.shields.io/badge/Backend-Railway-purple)](https://loomiq-production.up.railway.app/api/health)
[![Vercel](https://img.shields.io/badge/Frontend-Vercel-black)](https://loomiq.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)



> **Intelligent multi-agent orchestration engine** that routes, coordinates, and executes AI tasks across multiple LLMs — built from scratch without abstractions like LangChain, to deeply understand what production orchestration systems actually do.

---

![LoomIQ Demo](./docs/demo.gif)

---

## 📊 At a Glance

| Metric | Value |
|--------|-------|
| ⚡ Task Acknowledgment | `<50ms` |
| 🤖 AI Agents | Groq (Llama 3.1 70B) + Mistral (mistral-small) |
| 🔄 Collaboration Strategies | 4 (Sequential, Parallel, Hierarchical, Consensus) |
| 🔁 Retry Logic | 3× exponential backoff — 1s → 2s → 4s |
| 🛡️ Duplicate Executions | 0 — atomic execution lock |
| 🔐 Auth | JWT + RBAC (4 role levels) + bcrypt (12 rounds) |
| ☁️ Infrastructure | Railway + Vercel + Neon PostgreSQL |

---

## 🌟 Why LoomIQ Exists

Most developers reach for LangChain when building multi-agent systems. LangChain is powerful — but it abstracts away the hard parts: agent scoring, retry behavior, collaboration strategies, and execution deduplication.

**LoomIQ was built from scratch to solve these problems directly.**

In production, we discovered that:

- **LangChain's agent executor doesn't expose execution lock logic** — we hit duplicate execution bugs that required building our own atomic deduplication using Node.js single-thread guarantees
- **LangChain's retry abstraction doesn't let you tune backoff per LLM provider** — Groq and Mistral have different failure patterns requiring different retry windows
- **Collaboration strategies have unique edge cases** (Parallel aggregation, Hierarchical array indexing, Consensus context limits) that only surface in real usage — not in framework defaults

The result: deep enough understanding of orchestration internals to now **contribute to LangChain itself** — not just use it.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│              Client (React + TailwindCSS)            │
│   Task Creation · Real-time Terminal · Auth Flow     │
│   Agent Status Dashboard · SSE EventSource API       │
└─────────────────────────┬────────────────────────────┘
                          │ HTTP REST + SSE
                          ▼
┌──────────────────────────────────────────────────────┐
│          Express.js API Server  (Port 3000)          │
│  ┌──────────────┐  ┌───────────┐  ┌───────────────┐  │
│  │  Task Router │  │  Auth JWT │  │ Zod Validator │  │
│  └──────────────┘  └───────────┘  └───────────────┘  │
└─────────────────────────┬────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│                  Task Orchestrator                   │
│  • executionLock Set<string> — atomic deduplication  │
│  • 3× retry + exponential backoff (1s→2s→4s)         │
│  • Background processor — 10s crash recovery loop   │
│  • EventEmitter → zero-latency SSE push              │
└─────────────────────────┬────────────────────────────┘
                          │ requiresCollaboration()?
               ┌──────────┴──────────┐
               │ NO                  │ YES
               ▼                     ▼
      ┌────────────────┐   ┌──────────────────────────┐
      │  AgentRegistry │   │   Collaboration Manager  │
      │  6-factor score│   │  Sequential · Parallel   │
      │  Route to best │   │  Hierarchical · Consensus│
      └───────┬────────┘   └─────────────┬────────────┘
              │                          │
              └────────────┬─────────────┘
                           ▼
             ┌─────────────────────────┐
             │   MCP Hub  (Port 4000)  │
             │  Socket.IO · Pub/Sub    │
             └────────────┬────────────┘
                    ┌─────┴──────┐
                    ▼            ▼
             ┌──────────┐  ┌──────────┐
             │   Groq   │  │ Mistral  │
             │ Llama3.1 │  │ mistral  │
             │   70B    │  │  small   │
             └──────────┘  └──────────┘
                    │            │
                    └─────┬──────┘
                          ▼
                  ┌──────────────┐
                  │  PostgreSQL  │
                  │  (Neon)      │
                  │  TypeORM     │
                  └──────────────┘
```

---

## 🔄 Complete Request Flow

```
1.  POST /api/tasks + JWT Bearer token
2.  Auth middleware — JWT verified, user context extracted
3.  Zod validation — prompt min 1 char, enum type/priority
4.  Task created in PostgreSQL — UUID, status = pending
5.  HTTP 200 — taskId returned in <50ms
6.  Frontend opens SSE stream (EventSource /stream?token=...)
7.  executeTask() — executionLock checked atomically (dedup)
8.  AgentRegistry scores all agents → picks best idle agent
9.  Agent executes — 3 retry attempts (1s → 2s → 4s backoff)
10. SSE events fire: task:assigned → step:completed
11. Result + duration persisted to PostgreSQL
12. task:completed — terminal renders full output
    └── SSE drops? → frontend polls GET /tasks/:id every 3s
```

---

## 🤝 4 Collaboration Strategies

### 1. Sequential `→`
```
Agent A (Plan) → Agent B (Implement) → Agent A (Review)
```
Best for step-by-step pipelines. Use case: Design → Code → Test.

### 2. Parallel `⇉`
```
Agent A (Frontend) ─┐
                    ├─→ Aggregation → Final Result
Agent B (Backend)  ─┘
```
Best for independent workstreams. Use case: full-stack simultaneous development.

### 3. Hierarchical `▽`
```
Lead Agent (Plans + Decomposes)
    ├── Worker A (Executes Part 1)
    └── Worker B (Executes Part 2)
Lead Agent (Integrates + Reviews)
```
Best for complex projects. Use case: multi-component architecture delegation.

### 4. Consensus `⊕`
```
Agent A (Proposes) ─┐
Agent B (Proposes) ─┴─→ Compare → Best Answer → Execute
```
Best for critical decisions. Use case: architecture reviews, security trade-offs.

---

## 🎯 Agent Scoring Algorithm

```typescript
function calculateAgentScore(task: Task, agent: Agent): number {
  let score = 0;

  if (agent.capabilities.includes(task.type))               score += 20; // Category match
  if (metadataLanguageMatch(task, agent))                   score += 10; // Language match
  if (task.complexity === 'complex' && isCritical(task))    score += 15; // Complexity match
  if (agent.successRate > 90)                               score += 10; // High success rate
  if (agent.avgResponseTime < 5000)                         score += 5;  // Fast response
  if (agent.status !== 'idle')                              score -= 50; // Hard blocker
  if (agent.costTier === 'high' && task.priority === 'low') score -= 10; // Cost mismatch

  return score;
}
```

Routing flow: all agents scored → filter `status === 'idle'` → pick max score → assign → execute → retry 3× → persist → SSE emit.

---

## ⚡ Real-Time: SSE + Polling Fallback

**Why SSE over WebSockets:**
- Task monitoring is strictly unidirectional — server pushes, client listens
- SSE runs over plain HTTP — no upgrade handshake, works through every proxy and CDN
- Auto-reconnects natively on disconnect
- 5s keepalive heartbeat prevents Railway/Render proxy timeouts

**Polling Fallback:**
```
SSE connection drops (proxy timeout)
    → Frontend detects via EventSource.onerror
    → Switches to polling GET /api/tasks/:taskId every 3s
    → Task result already in PostgreSQL
    → User always gets their answer — zero data loss
```

---

## 🔑 Key Design Decisions

### Atomic Execution Lock
```typescript
// Checked synchronously before any await
// Node.js is single-threaded — two calls for the same taskId
// cannot both pass this check in the same tick
if (this.executionLock.has(taskId)) return;
this.executionLock.add(taskId);
```
**Trade-off:** Works only in single-process. Multi-instance needs Redis SETNX.

### Exponential Backoff — Why 1s/2s/4s
Groq and Mistral fail transiently with 503s and timeouts. Three attempts catches 99% of flaky calls with a max 7s delay before final failure. Tuned from real production failures — not framework defaults.

### Background Processor — Why 10s Loop
Safety net for tasks that miss `executeTask()` due to server crash. Tasks remain `pending` in PostgreSQL and recover within 10 seconds on restart. **Trade-off:** Up to 10s recovery lag. BullMQ + Redis would eliminate this.

### In-Memory Collaboration Sessions
Collaboration state lives in memory during execution for zero-latency step coordination. Final results persist to PostgreSQL. **Trade-off:** Server restart mid-collaboration loses session. DB-backed sessions on roadmap.

---

## 🛠️ Tech Stack

**Backend**
- Node.js 18+ + TypeScript (strict mode)
- Express.js + TypeORM 0.3
- PostgreSQL — Neon serverless
- JWT + bcrypt (12 rounds) + Zod validation

**Frontend**
- React 18 + TypeScript + Vite
- TailwindCSS
- SSE (native EventSource API)

**AI Integration**
- Groq — Llama 3.1 70B (fast inference, code generation)
- Mistral — mistral-small (planning, multilingual, review)
- agents.yaml — declarative agent configuration

**Infrastructure**
- Railway (backend + MCP hub)
- Vercel (frontend)
- Neon (PostgreSQL)

---

## ⚙️ Local Setup

### Prerequisites
- Node.js >= 18.x
- PostgreSQL >= 14.x (or [Neon](https://neon.tech) free tier)
- [Groq API Key](https://console.groq.com)
- [Mistral API Key](https://console.mistral.ai)

### Installation

```bash
git clone https://github.com/Aayush-engineer/loomiq.git
cd loomiq

cd server && npm install
cd ../client && npm install
```

### Environment Variables

**`server/.env`**
```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/loomiq
DB_HOST=your-neon-host.neon.tech
DB_PORT=5432
DB_NAME=loomiq
DB_USERNAME=your-username
DB_PASSWORD=your-password
DB_SSL=true

# AI Keys
GROQ_API_KEY=gsk_your_groq_key
MISTRAL_API_KEY=your_mistral_key

# Server
PORT=3000
NODE_ENV=development
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=7d

# MCP
MCP_PORT=4000
MCP_SECRET_KEY=your-mcp-secret

# Required — generate a UUID for your default org
DEFAULT_ORG_ID=your-default-org-uuid

# CORS
CORS_ORIGIN=http://localhost:5173

# Orchestration
MAX_CONCURRENT_TASKS=10
```

**`client/.env`**
```env
VITE_API_URL=http://localhost:3000/api
```

### Run

```bash
# Terminal 1 — Backend
cd server && npm run dev

# Terminal 2 — Frontend
cd client && npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000 |
| Health Check | http://localhost:3000/api/health |
| MCP Hub | http://localhost:4000 |

### Database

```bash
cd server
npm run typeorm migration:run

# Development only — set DB_SYNCHRONIZE=true in .env for auto-sync
```

---

## 🌐 API Reference

```bash
# Health
GET  /api/health

# Auth
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh

# Tasks
POST   /api/tasks           # Create task
GET    /api/tasks           # List tasks (org-scoped)
GET    /api/tasks/:id       # Get task + status
DELETE /api/tasks/:id       # Cancel task

# Agents
GET /api/agents             # Agent list + live status

# Real-time
GET /api/stream?token=<jwt> # SSE event stream
```

**Example: Create a task**
```bash
curl -X POST https://loomiq-production.up.railway.app/api/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Design and implement a REST API for user authentication",
    "type": "implementation",
    "priority": "high"
  }'
```

---

## 🗺️ Roadmap

**Phase 1 — Production Grade**
- [ ] Docker Compose — one command local startup
- [ ] GitHub Actions CI — automated test pipeline
- [ ] Circuit breaker — stop calling failing agents
- [ ] Swagger API docs at `/api/docs`
- [ ] Collaboration session persistence to DB

**Phase 2 — Intelligent System**
- [ ] BullMQ + Redis — replace 10s polling loop
- [ ] Task result caching by prompt hash (SHA-256)
- [ ] Agent performance learning — dynamic scoring from historical win rate
- [ ] Cost tracking per task and per agent

**Phase 3 — Platform**
- [ ] Human-in-the-loop approval UI
- [ ] Agent analytics dashboard
- [ ] Public API with rate limiting tiers
- [ ] Plugin system for custom agents

---

## 🔐 Security Practices

```typescript
// TypeORM — parameterized queries, SQL injection safe
const task = await taskRepo.findOne({ where: { id } });

// JWT — 7 day expiry, verified on every request
jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

// CORS — whitelist only, no wildcard in production
app.use(cors({ origin: process.env.CORS_ORIGIN }));

// Zod — every endpoint validated before execution
const schema = z.object({
  prompt: z.string().min(1),
  type: z.enum(['implementation', 'design', 'test', 'planning']),
  priority: z.enum(['low', 'medium', 'high', 'critical'])
});
```

---

## 🤝 Contributing

```bash
git checkout -b feature/your-feature
git commit -m 'feat: describe your change clearly'
git push origin feature/your-feature
# Open Pull Request — describe what and why
```

Follow existing TypeScript strict mode patterns. Add JSDoc for public APIs.

---

## 👤 Author

**Aayush Kumar**
- 🐙 GitHub: [@Aayush-engineer](https://github.com/Aayush-engineer)
- 📧 Email: aayushkumarsingh245@gmail.com

---

## 🙏 Acknowledgments

- [Groq](https://groq.com) — blazing fast LLM inference
- [Mistral AI](https://mistral.ai) — multilingual language models
- [Railway](https://railway.app) — backend deployment
- [Vercel](https://vercel.com) — frontend edge hosting
- [Neon](https://neon.tech) — serverless PostgreSQL

---

⭐ **Star this repo if you find it helpful!**