 
# 🌌 LOOMIQ 

**Production-ready orchestration system that coordinates multiple AI agents to collaboratively solve complex tasks through intelligent routing and distributed execution strategies.**

## 🎯 What is Loomiq?

Loomiq is a sophisticated **multi-agent orchestration platform** that revolutionizes how AI models work together. Instead of relying on a single AI provider, Loomiq intelligently coordinates multiple AI agents (Groq, Mistral, OpenAI, etc.) to collaborate on complex tasks using proven distributed computing patterns.

**Key Innovation:** Automatic task decomposition, intelligent agent selection, and real-time collaborative execution with built-in fallback strategies and performance monitoring.

---

## ✨ Core Features

### 🤖 **Intelligent Multi-Agent System**
- **Pluggable Architecture**: Easy integration with any AI provider (Groq, Mistral, OpenAI, Claude)
- **Dynamic Agent Registry**: Runtime registration and discovery of available agents
- **Capability-Based Routing**: Automatic selection of best-suited agent(s) for each task
- **Health Monitoring**: Real-time agent status tracking with automatic failover

### 🤝 **Advanced Collaboration Strategies**

#### **Sequential Collaboration**
Agents work in pipeline mode, each improving on the previous agent's output:
```
Task → Agent 1 (Initial) → Agent 2 (Review) → Agent 3 (Polish) → Result
```
**Use Cases:** Code reviews, iterative refinement, quality assurance workflows

#### **Parallel Collaboration**  
Multiple agents tackle the same problem simultaneously for diverse perspectives:
```
Task → [Agent 1 + Agent 2 + Agent 3] → Aggregated Results
```
**Use Cases:** Brainstorming, solution comparison, risk analysis, A/B testing

#### **Consensus Collaboration**
Democratic decision-making with collective intelligence:
```
Task → All Agents Analyze → Lead Agent Synthesizes → Unified Solution
```
**Use Cases:** Architecture decisions, critical validations, strategic planning

### ⚡ **Production-Grade Infrastructure**
- **Event-Driven Architecture**: WebSocket-based real-time communication hub
- **Task Queue Management**: Priority-based scheduling with dependency resolution
- **Comprehensive Logging**: Structured logging with Winston (console + file rotation)
- **Error Handling**: Graceful degradation with retry logic and circuit breakers
- **Authentication**: JWT-based security with role-based access control
- **RESTful API**: Full CRUD operations with OpenAPI documentation

### 📊 **Analytics & Monitoring**
- Real-time performance metrics (response time, success rate, cost tracking)
- Collaboration session analytics
- Agent utilization and load balancing insights
- Task history and audit trails

---

## 🏗️ Architecture & Design Patterns

### **System Architecture**

```
┌─────────────────────────────────────────────────────────────────┐
│                      Client Applications                        │
│               (Web UI, CLI, Mobile, External APIs)              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST API / WebSocket
┌───────────────────────────▼─────────────────────────────────────┐
│                     Express.js Server (Port 3000)               │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Auth Middleware (JWT)  │  CORS  │  JSON Parser        │     │
│  └────────────────────────────────────────────────────────┘     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                      Task Orchestrator                          │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  • Task Queue with Priority Scheduling                 │     │
│  │  • Auto-detect Collaboration Need                      │     │
│  │  • Strategy Selection (Sequential/Parallel/Consensus)  │     │
│  │  • Task Lifecycle Management                           │     │
│  │  • Performance Metrics Collection                      │     │
│  └────────────────────────────────────────────────────────┘     │
└──────────────┬──────────────────────┬───────────────────────────┘
               │                      │
       ┌───────▼────────┐     ┌──────▼──────────┐
       │ Agent Registry │     │  Collaboration  │
       │                │     │    Manager      │
       │ • Agent Pool   │     │                 │
       │ • Capability   │     │ • Session Mgmt  │
       │   Matching     │     │ • Sequential    │
       │ • Health Check │     │ • Parallel      │
       │ • Load Balance │     │ • Consensus     │
       │ • Cost Track   │     │ • Result Agg    │
       └───────┬────────┘     └──────┬──────────┘
               │                     │
               └──────────┬──────────┘
                          │
       ┌──────────────────▼────────────────────┐
       │    Communication Hub (MCP-Based)      │
       │  ┌────────────────────────────────┐   │
       │  │  MCP Server (Socket.IO)        │   │
       │  │  • Port 4000 (WebSocket)       │   │
       │  │  • Token-based Auth            │   │
       │  │  • Event Pub/Sub               │   │
       │  │  • Tool Registry & Execution   │   │
       │  │  • HTTP REST Endpoints         │   │
       │  └────────────────────────────────┘   │
       │                                       │
       │  Channel Types:                       │
       │  • Direct (1:1 Agent Communication)   │
       │  • Broadcast (1:N Agent Groups)       │
       │  • PubSub (Event Broadcasting)        │
       └──────────────────┬────────────────────┘
                          │
       ┌──────────────────┴────────────────────┐
       │     Per-Agent MCP Clients             │
       │  • Auto-reconnect with Backoff        │
       │  • Message Queuing                    │
       │  • Health Monitoring                  │
       └──────────────────┬────────────────────┘
                          │
    ┌─────────────────────┴───────────────────────────┐
    │                                                 │
┌───▼───────┐   ┌──────────┐   ┌──────────┐   ┌───────▼────┐
│   Groq    │   │ Mistral  │   │  OpenAI  │   │   Claude   │
│   Agent   │   │  Agent   │   │  Agent   │   │   Agent    │
│           │   │          │   │          │   │            │
│ • MCP     │   │ • MCP    │   │ • MCP    │   │ • MCP      │
│   Client  │   │   Client │   │   Client │   │   Client   │
│ • HTTP    │   │ • HTTP   │   │ • HTTP   │   │ • HTTP     │
│   Client  │   │   Client │   │   Client │   │   Client   │
│ • Conv    │   │ • Conv   │   │ • Conv   │   │ • Conv     │
│   History │   │   History│   │   History│   │   History  │
│           │   │          │   │          │   │            │
│ LLaMA 3.1 │   │ Large    │   │ GPT-4    │   │ Sonnet 4   │
└───────────┘   └──────────┘   └──────────┘   └────────────┘
```

### **Folder Structure**

```
loomiq/
├── config/
│   └── agents.yaml                    # Agent configurations & capabilities
├── src/
│   ├── agents/
│   │   ├── base-agent.ts             # Abstract base (lifecycle, stats, events)
│   │   ├── api-agent.ts              # HTTP abstraction (Axios + interceptors)
│   │   ├── agent-registry.ts         # Discovery, selection, load balancing
│   │   └── implementations/
│   │       ├── groq-agent.ts         # Groq LLaMA (streaming, conv history)
│   │       └── mistral-agent.ts      # Mistral AI (tool use, embeddings)
│   ├── collaboration/
│   │   └── collaboration-manager.ts  # Strategy execution (Seq/Par/Consensus)
│   ├── communication/
│   │   ├── communication-hub.ts      # Central message router
│   │   ├── mcp-server.ts             # Socket.IO server (Port 4000)
│   │   └── mcp-client.ts             # Per-agent MCP connection
│   ├── orchestration/
│   │   └── task-orchestrator.ts      # Task queue, routing, execution
│   ├── database/
│   │   └── database-service.ts       # PostgreSQL (connection pooling)
│   ├── middleware/
│   │   └── auth-middleware.ts        # JWT validation, RBAC
│   ├── routes/
│   │   └── auth-routes.ts            # /api/auth endpoints
│   ├── services/
│   │   └── auth-service.ts           # Token generation/validation
│   ├── interfaces/
│   │   ├── agent.interface.ts        # Agent, AgentRequest, AgentResponse
│   │   ├── task.interface.ts         # Task, TaskStatus, Priority
│   │   └── communication.interface.ts # Message, Channel, MCPTool
│   └── index.ts                       # Bootstrap (server + MCP startup)
├── logs/
│   ├── orchestrator.log              # System-wide events
│   └── agent-*.log                    # Per-agent detailed logs
├── .env                               # Environment variables
├── package.json                       # Dependencies & scripts
└── tsconfig.json                      # TypeScript configuration
```

### **Design Patterns Implemented**

| Pattern | Location | Purpose |
|---------|----------|---------|
| **Strategy** | `collaboration-manager.ts` | Pluggable collaboration algorithms (Sequential/Parallel/Consensus) |
| **Factory** | `agent-registry.ts` | Dynamic agent instantiation based on provider type |
| **Singleton** | `database-service.ts` | Single shared database connection pool |
| **Observer** | `EventEmitter` (throughout) | Event-driven architecture for real-time updates |
| **Template Method** | `base-agent.ts` | Agent lifecycle hooks (onInitialize, onExecute, onShutdown) |
| **Adapter** | `api-agent.ts` | Unified HTTP interface for diverse AI provider APIs |
| **Registry** | `agent-registry.ts` | Centralized agent discovery and management |
| **Pub/Sub** | `communication-hub.ts` | Decoupled message broadcasting via MCP |
| **Circuit Breaker** | `api-agent.ts` | Automatic failover for rate-limited/failed agents |
| **Chain of Responsibility** | `collaboration-manager.ts` | Sequential agent pipeline for iterative refinement |

---

## 🌐 Model Context Protocol (MCP) Implementation

Loomiq implements a custom **Model Context Protocol** for real-time, bidirectional communication between the orchestrator and distributed agents.

### **MCP Architecture**

```
┌────────────────────────────────────────────────────────┐
│              MCP Server (Port 4000)                    │
│  ┌────────────────────────────────────────────────┐    │
│  │  Socket.IO Server                              │    │
│  │  • Token-based authentication                  │    │
│  │  • Auto-reconnection with exponential backoff  │    │
│  │  • Room-based event routing                    │    │
│  └────────────────────────────────────────────────┘    │
│                                                        │
│  REST API (Express):                                   │
│  • GET  /tools          → List registered tools        │
│  • POST /tools/:name/execute → Execute tool            │
│  • GET  /health         → Server health status         │
│                                                        │
│  WebSocket Events:                                     │
│  • connection           → Client connected             │
│  • subscribe            → Join event room              │
│  • unsubscribe          → Leave event room             │
│  • broadcast            → Send to all subscribers      │
│  • tool-registered      → New tool available           │
│  • tool-unregistered    → Tool removed                 │
└────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
      ┌───────▼────────┐      ┌────────▼───────┐
      │  MCP Client 1  │      │  MCP Client 2  │
      │  (Agent Groq)  │      │ (Agent Mistral)│
      │                │      │                │
      │ • Subscribe to │      │ • Subscribe to │
      │   task events  │      │   task events  │
      │ • Emit status  │      │ • Emit status  │
      │   updates      │      │   updates      │
      └────────────────┘      └────────────────┘
```

### **MCP Features**

**1. Tool Registry & Execution**
Agents can register custom tools (functions) that other agents can discover and execute:

```typescript
// Register a tool on MCP server
mcpServer.registerTool({
  name: 'code_analyzer',
  description: 'Analyzes code for bugs and optimizations',
  inputSchema: { code: 'string', language: 'string' },
  outputSchema: { issues: 'array', suggestions: 'array' },
  handler: async (input) => {
    // Tool implementation
    return { issues: [...], suggestions: [...] };
  }
});

// Agent executes tool remotely
const result = await mcpClient.executeTool('code_analyzer', {
  code: userCode,
  language: 'typescript'
});
```

**2. Channel-Based Communication**

```typescript
// Direct channel (1:1 communication)
const directChannel = hub.createChannel('direct', ['agent-1', 'agent-2']);
await directChannel.send({
  from: 'agent-1',
  to: 'agent-2',
  type: 'task-handoff',
  payload: { taskId: '123', context: {...} }
});

// Broadcast channel (1:N communication)
const broadcastChannel = hub.createChannel('broadcast', [
  'agent-1', 'agent-2', 'agent-3'
]);
await broadcastChannel.send({
  from: 'orchestrator',
  type: 'collaboration-start',
  payload: { sessionId: 'abc', strategy: 'consensus' }
});
```

**3. Event Subscription System**

```typescript
// Subscribe to specific events
const subscription = hub.subscribe(
  'task:completed',
  'agent-dashboard',
  (event) => {
    console.log(`Task ${event.taskId} completed by ${event.agentId}`);
  }
);

// Publish events to subscribers
hub.publish('agent:status-changed', {
  agentId: 'groq-001',
  oldStatus: 'idle',
  newStatus: 'busy'
});
```

**4. Authentication & Security**

```typescript
// MCP Server enforces token-based auth
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${MCP_SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Socket.IO connection with authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (token !== secretKey) {
    return next(new Error('Authentication failed'));
  }
  next();
});
```

**5. Auto-Reconnection with Backoff**

```typescript
// MCP Client handles disconnections gracefully
socket = io(serverUrl, {
  auth: { token: secretKey },
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,  // Exponential backoff
  reconnectionDelayMax: 5000
});
```

### **MCP vs Traditional REST**

| Feature | MCP (WebSocket) | REST API |
|---------|----------------|----------|
| **Communication** | Bidirectional, real-time | Request-response only |
| **Latency** | ~10-50ms | ~100-300ms |
| **Push Updates** | ✅ Native | ❌ Requires polling |
| **Connection** | Persistent | Stateless |
| **Scalability** | Horizontal (with Redis) | Vertical/Horizontal |
| **Use Case** | Real-time collab, events | CRUD operations |

---

## 🚀 Getting Started

### **Prerequisites**

- Node.js 16+ and npm/yarn
- PostgreSQL 13+ (or compatible database)
- API keys for AI providers (Groq, Mistral, etc.)

### **Installation**

```bash
# Clone repository
git clone https://github.com/yourusername/loomiq.git
cd loomiq

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

### **Environment Configuration**

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/loomiq

# Authentication
JWT_SECRET=your-secret-key-here
JWT_EXPIRATION=24h

# Communication Hub
WEBSOCKET_PORT=4000
MCP_SERVER_URL=http://localhost:4000
MCP_SECRET_KEY=your-mcp-secret

# AI Provider API Keys
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxx
MISTRAL_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx
```

### **Agent Configuration** (`config/agents.yaml`)

```yaml
agents:
  - id: groq-001
    name: "Groq Fast Agent"
    provider: groq
    model: llama-3.1-70b-versatile
    endpoint: https://api.groq.com/openai/v1
    capabilities: 
      - coding
      - analysis
      - reasoning
    cost:
      perToken: 0.000001
    timeout: 60000
    systemPrompt: "You are an expert coding assistant in a collaborative AI system."

  - id: mistral-001
    name: "Mistral Reviewer"
    provider: mistral
    model: mistral-large-latest
    endpoint: https://api.mistral.ai/v1
    capabilities:
      - review
      - validation
      - refinement
    cost:
      perToken: 0.000002
    timeout: 90000
```

### **Run the Application**

```bash
# Development (with hot reload)
npm run dev

# Production build
npm run build
npm start

# Run with PM2 (recommended for production)
pm2 start dist/index.js --name loomiq-orchestrator
```

**API will be available at:** `http://localhost:3000`  
**WebSocket Hub at:** `ws://localhost:4000`

---

## 📡 API Documentation

### **Task Management**

#### **Create and Execute Task**

```bash
POST /api/tasks
Content-Type: application/json
Authorization: Bearer <jwt_token>

{
  "prompt": "Build a REST API for user management with JWT auth",
  "type": "implementation",
  "priority": "high",
  "useCollaboration": true,
  "collaborationStrategy": {
    "type": "sequential"
  },
  "context": {
    "framework": "Express.js",
    "database": "PostgreSQL"
  }
}
```

**Response:**
```json
{
  "success": true,
  "task": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Build a REST API for user management...",
    "status": "completed",
    "type": "implementation",
    "priority": "high",
    "assignedAgent": "groq-001",
    "createdAt": "2024-01-15T10:30:00Z",
    "completedAt": "2024-01-15T10:32:45Z",
    "actualDuration": 165000
  },
  "result": {
    "collaborationSession": "abc123",
    "results": [
      {
        "agentId": "groq-001",
        "agentName": "Groq Fast Agent",
        "output": {
          "content": "// Complete REST API implementation...",
          "metadata": {
            "tokensUsed": 2500,
            "cost": 0.0025
          }
        },
        "duration": 82000
      },
      {
        "agentId": "mistral-001",
        "agentName": "Mistral Reviewer",
        "output": {
          "content": "// Reviewed and improved code...",
          "metadata": {
            "tokensUsed": 1800,
            "cost": 0.0036
          }
        },
        "duration": 83000
      }
    ]
  }
}
```

#### **Get Task Status**

```bash
GET /api/tasks/:taskId
Authorization: Bearer <jwt_token>
```

#### **List All Tasks** (with filtering)

```bash
GET /api/tasks?status=completed&priority=high&type=implementation
Authorization: Bearer <jwt_token>
```

#### **Force Collaboration on Existing Task**

```bash
POST /api/tasks/:taskId/collaborate
Authorization: Bearer <jwt_token>
```

### **Agent Management**

#### **Get All Agents Status**

```bash
GET /api/agents
```

**Response:**
```json
{
  "agents": [
    {
      "id": "groq-001",
      "name": "Groq Fast Agent",
      "provider": "groq",
      "status": {
        "state": "idle",
        "totalTasksCompleted": 47,
        "successRate": 95.7,
        "averageResponseTime": 3200,
        "lastActivity": "2024-01-15T10:32:45Z"
      },
      "capabilities": ["coding", "analysis", "reasoning"]
    }
  ]
}
```

### **System Monitoring**

#### **Get Orchestrator Statistics**

```bash
GET /api/stats
```

**Response:**
```json
{
  "stats": {
    "total": 150,
    "pending": 5,
    "running": 3,
    "completed": 138,
    "failed": 4,
    "collaborative": 67,
    "collaborationSessions": 67,
    "averageDuration": 45000,
    "byStrategy": {
      "sequential": 40,
      "parallel": 15,
      "consensus": 12
    }
  }
}
```

#### **Health Check**

```bash
GET /api/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:35:00Z",
  "version": "1.0.0",
  "uptime": 86400
}
```

---

## 🔧 Technical Implementation Details

### **Agent Lifecycle Management**

Every agent follows a strictly defined lifecycle with comprehensive error handling:

```typescript
// Base Agent Implementation
abstract class BaseAgentImplementation {
  // Phase 1: Initialization
  async initialize() {
    this.logger.info('Initializing agent');
    
    // Connect to MCP server for real-time communication
    if (this.config.endpoint?.startsWith('http')) {
      this.mcpClient = new MCPClient(MCP_SERVER_URL, MCP_SECRET_KEY);
      await this.mcpClient.connect();
    }
    
    await this.onInitialize();  // Provider-specific setup
    this.status.state = 'idle';
    this.emit('initialized', { agentId: this.config.id });
  }

  // Phase 2: Task Execution with Timeout Protection
  async execute(request: AgentRequest) {
    const startTime = Date.now();
    this.currentTask = request;
    this.status.state = 'busy';
    this.status.currentTask = request.taskId;

    try {
      this.emit('task:started', { agentId: this.id, taskId: request.taskId });
      
      // Race between task execution and timeout
      const timeout = request.timeout || this.config.timeout || 300000;
      const result = await Promise.race([
        this.onExecute(request),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Task timeout')), timeout)
        )
      ]);

      response.result = result;
      response.success = true;
      this.logger.info(`Task ${request.taskId} completed successfully`);
      
    } catch (error) {
      response.error = error.message;
      response.success = false;
      this.logger.error(`Task ${request.taskId} failed`, error);
      
    } finally {
      response.duration = Date.now() - startTime;
      this.taskHistory.push(response);
      this.updateStatistics();  // Track success rate, avg response time
      
      this.currentTask = null;
      this.status.state = 'idle';
      this.emit('task:completed', { taskId, success, duration });
    }

    return response;
  }

  // Phase 3: Graceful Shutdown
  async shutdown() {
    this.logger.info('Shutting down agent');
    
    if (this.currentTask) {
      this.logger.warn('Shutting down with active task');
    }
    
    if (this.mcpClient) {
      await this.mcpClient.disconnect();
    }
    
    await this.onShutdown();  // Provider-specific cleanup
    this.status.state = 'offline';
    this.emit('shutdown', { agentId: this.config.id });
  }

  // Automatic statistics tracking
  private updateStatistics() {
    const completed = this.taskHistory.filter(t => t.taskId !== '');
    const successful = completed.filter(t => t.success);
    
    this.status.totalTasksCompleted = completed.length;
    this.status.successRate = (successful.length / completed.length) * 100;
    this.status.averageResponseTime = 
      completed.reduce((sum, t) => sum + t.duration, 0) / completed.length;
  }
}
```

### **API Agent HTTP Abstraction**

All API-based agents inherit unified HTTP handling with automatic retry logic:

```typescript
abstract class APIAgent extends BaseAgentImplementation {
  protected httpClient: AxiosInstance;

  constructor(config: AgentConfig) {
    super(config);
    
    // Auto-resolve API key from env vars
    this.apiKey = config.apiKey || 
      process.env[`${config.provider.toUpperCase()}_API_KEY`];
    
    // Create HTTP client with interceptors
    this.httpClient = axios.create({
      baseURL: this.endpoint,
      timeout: config.timeout || 60000,
      headers: this.getDefaultHeaders()
    });
    
    this.setupInterceptors();
  }

  // Automatic retry with exponential backoff
  protected setupInterceptors() {
    this.httpClient.interceptors.response.use(
      response => response,
      async error => {
        // Handle rate limiting (429)
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'] || 60;
          this.logger.warn(`Rate limited, retrying after ${retryAfter}s`);
          await this.sleep(retryAfter * 1000);
          return this.httpClient.request(error.config);
        }
        
        // Handle auth errors (401)
        if (error.response?.status === 401) {
          throw new Error('Authentication failed - check API key');
        }
        
        // Handle service unavailable (503)
        if (error.response?.status === 503) {
          throw new Error('AI provider temporarily unavailable');
        }
        
        throw error;
      }
    );
  }

  // Unified execution flow
  protected async onExecute(request: AgentRequest) {
    const apiRequest = this.buildAPIRequest(request);
    const response = await this.httpClient.request(apiRequest);
    return this.parseAPIResponse(response.data, request);
  }

  // Cost calculation
  protected calculateCost(tokensUsed: number): number {
    if (this.config.cost?.perToken) {
      return tokensUsed * this.config.cost.perToken;
    }
    return this.config.cost?.perRequest || 0;
  }
}
```

### **Groq Agent Implementation Details**

```typescript
export class GroqAgent extends APIAgent {
  private conversationHistory: Array<{role: string, content: string}> = [];

  protected buildAPIRequest(request: AgentRequest) {
    const messages = [];
    
    // System prompt with role context
    messages.push({
      role: 'system',
      content: this.config.systemPrompt || 
        'You are an AI assistant in a multi-agent system.'
    });
    
    // Add collaboration context
    if (request.context?.role) {
      messages.push({
        role: 'system',
        content: `Your role: ${request.context.role}`
      });
    }
    
    // Include previous agent's work for sequential collaboration
    if (request.context?.previousResult) {
      messages.push({
        role: 'system',
        content: `Previous work:\n${JSON.stringify(
          request.context.previousResult, null, 2
        )}`
      });
    }
    
    // Add conversation history (keep last 10 messages)
    messages.push(...this.conversationHistory);
    
    // Current user message
    messages.push({
      role: 'user',
      content: request.prompt
    });

    return {
      method: 'POST',
      url: '/chat/completions',
      data: {
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: 8000
      }
    };
  }

  protected parseAPIResponse(response: any, request: AgentRequest) {
    const content = response.choices[0].message?.content;
    
    // Update conversation history
    this.conversationHistory.push(
      { role: 'user', content: request.prompt },
      { role: 'assistant', content }
    );
    
    // Keep only last 10 messages to avoid context overflow
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }
    
    return {
      content,
      finishReason: response.choices[0].finish_reason,
      metadata: {
        model: this.model,
        tokensUsed: response.usage?.total_tokens,
        cost: this.calculateCost(response.usage?.total_tokens || 0)
      }
    };
  }
  
  // Public API for conversation management
  public clearConversationHistory() {
    this.conversationHistory = [];
    this.logger.info('Cleared conversation history');
  }
}
```

### **Collaboration Session Management**

The CollaborationManager orchestrates complex multi-agent workflows:

```typescript
class CollaborationManager {
  // Create session with selected agents
  async createCollaborationSession(task: Task, strategy: CollaborationStrategy) {
    // Auto-select best agents based on capabilities
    const agents = await this.selectAgentsForTask(task, strategy);
    
    if (agents.length < 2) {
      throw new Error('Need at least 2 agents for collaboration');
    }

    const session: CollaborationSession = {
      id: uuidv4(),
      taskId: task.id,
      agents: agents.map(a => a.id),
      strategy: strategy.type,
      status: 'planning',
      results: [],
      createdAt: new Date()
    };

    this.sessions.set(session.id, session);
    this.emit('session:created', session);
    return session;
  }

  // Sequential: Agents improve each other's work
  async executeSequential(session: CollaborationSession) {
    const task = await this.getTask(session.taskId);
    let previousResult = null;

    for (let i = 0; i < session.agents.length; i++) {
      const agent = this.agentRegistry.getAgent(session.agents[i]);
      const role = i === 0 ? 'initiator' : 'reviewer';
      
      // Build context-aware prompt
      const prompt = this.buildSequentialPrompt(task, role, previousResult);
      
      this.emit('step:started', { 
        session, 
        step: { name: `${role} - ${agent.config.name}` } 
      });

      const response = await agent.execute({
        taskId: session.taskId,
        prompt,
        context: {
          collaborationSession: session.id,
          role,
          previousResult
        }
      });

      if (response.success) {
        session.results.push({
          agentId: agent.id,
          agentName: agent.config.name,
          output: response.result,
          duration: response.duration,
          timestamp: new Date()
        });
        
        previousResult = response.result;
        this.emit('step:completed', { session, result: response.result });
      }
    }

    return session.results;
  }

  // Parallel: All agents work simultaneously
  async executeParallel(session: CollaborationSession) {
    const task = await this.getTask(session.taskId);
    
    // Execute all agents concurrently
    const agentPromises = session.agents.map(async (agentId) => {
      const agent = this.agentRegistry.getAgent(agentId);
      
      this.emit('step:started', { 
        session, 
        step: { name: `Parallel - ${agent.config.name}` }
      });

      const response = await agent.execute({
        taskId: session.taskId,
        prompt: `${task.description}\n\nProvide your independent solution.`,
        context: { mode: 'parallel' }
      });

      return response.success ? {
        agentId: agent.id,
        agentName: agent.config.name,
        output: response.result,
        duration: response.duration,
        timestamp: new Date()
      } : null;
    });

    const results = await Promise.all(agentPromises);
    return results.filter(r => r !== null);
  }

  // Consensus: Democratic decision-making
  async executeConsensus(session: CollaborationSession) {
    const task = await this.getTask(session.taskId);
    
    // Phase 1: All agents analyze independently
    const analyses = [];
    for (const agentId of session.agents) {
      const agent = this.agentRegistry.getAgent(agentId);
      const response = await agent.execute({
        taskId: session.taskId,
        prompt: `${task.description}\n\nProvide your analysis and approach.`,
        context: { mode: 'analysis' }
      });
      
      if (response.success) {
        analyses.push({
          agentId: agent.id,
          agentName: agent.config.name,
          output: response.result,
          duration: response.duration,
          timestamp: new Date()
        });
      }
    }

    // Phase 2: Lead agent builds consensus
    const leadAgent = this.agentRegistry.getAgent(session.agents[0]);
    const consensusPrompt = this.buildConsensusPrompt(task, analyses);
    
    const finalResponse = await leadAgent.execute({
      taskId: session.taskId,
      prompt: consensusPrompt,
      context: { mode: 'consensus', analyses }
    });

    analyses.push({
      agentId: leadAgent.id,
      agentName: `${leadAgent.config.name} (Consensus)`,
      output: finalResponse.result,
      duration: finalResponse.duration,
      timestamp: new Date()
    });

    return analyses;
  }

  // Intelligent agent selection based on capabilities
  private async selectAgentsForTask(
    task: Task, 
    strategy: CollaborationStrategy
  ) {
    const agentScores = this.agentRegistry.findBestAgentForTask(task);
    const numAgents = strategy.type === 'consensus' ? 3 : 2;
    
    return agentScores
      .slice(0, numAgents)
      .map(s => this.agentRegistry.getAgent(s.agentId))
      .filter(a => a !== undefined);
  }

  // Build prompts with collaboration context
  private buildSequentialPrompt(task: Task, role: string, previousResult: any) {
    if (role === 'initiator') {
      return `${task.description}\n\nYou are the first agent. Provide initial solution.`;
    }
    
    return `${task.description}

Previous agent's work:
${JSON.stringify(previousResult, null, 2)}

Review and improve:
1. What works well
2. What could be improved
3. Your improved version`;
  }

  private buildConsensusPrompt(task: Task, analyses: CollaborationResult[]) {
    const analysesText = analyses.map((a, i) => 
      `Agent ${i + 1} (${a.agentName}):
${JSON.stringify(a.output, null, 2)}`
    ).join('\n\n');

    return `${task.description}

Multiple agents analyzed this task:

${analysesText}

Build consensus solution:
1. Best ideas from each analysis
2. Address conflicts
3. Unified, coherent solution`;
  }
}
```

### **Event-Driven Real-Time Updates**

```typescript
// Orchestrator emits events during execution
orchestrator.on('task:created', (task) => {
  websocket.broadcast({ type: 'task_created', data: task });
});

orchestrator.on('collaboration:step_started', ({ stepName, agentId }) => {
  websocket.broadcast({ 
    type: 'step_started', 
    data: { step: stepName, agent: agentId }
  });
});
```

---

## 💡 Advanced Use Cases

### **1. Multi-Stage Code Review Pipeline**

```javascript
const task = await orchestrator.createTask({
  prompt: "Review this Python API for security vulnerabilities",
  type: "review",
  useCollaboration: true,
  collaborationStrategy: { type: "sequential" }
});

// Flow: Groq (initial review) → Mistral (security audit) → Final report
```

### **2. Parallel Solution Comparison**

```javascript
const task = await orchestrator.createTask({
  prompt: "Design a microservices architecture for an e-commerce platform",
  type: "architecture",
  useCollaboration: true,
  collaborationStrategy: { type: "parallel" }
});

// All agents propose designs simultaneously, user compares approaches
```

### **3. Consensus-Based Decision Making**

```javascript
const task = await orchestrator.createTask({
  prompt: "Should we migrate to Kubernetes? Analyze pros/cons",
  type: "analysis",
  priority: "critical",
  useCollaboration: true,
  collaborationStrategy: { type: "consensus" }
});

// All agents analyze independently, lead agent synthesizes final recommendation
```

### **4. Automatic Collaboration Detection**

```javascript
// Loomiq auto-detects complexity and enables collaboration
const task = await orchestrator.createTask({
  prompt: "Build a full-stack e-commerce app with real-time inventory"
  // useCollaboration: auto-enabled due to complexity keywords
});
```

---

## 📊 Performance & Monitoring

### **Built-in Metrics**

- **Task Completion Rate**: Percentage of successfully completed tasks
- **Average Response Time**: Mean execution time per task type
- **Agent Utilization**: Load distribution across agents
- **Collaboration Success Rate**: Effectiveness of collaborative strategies
- **Cost Tracking**: Token usage and API costs per task

### **Logging Strategy**

```typescript
// Structured logging with Winston
logger.info('Task execution started', {
  taskId: task.id,
  agentId: agent.id,
  priority: task.priority,
  estimatedCost: 0.05
});

// Separate log files per agent
logs/
  ├── orchestrator.log      # System-wide events
  ├── agent-groq-001.log    # Groq agent specific
  └── agent-mistral-001.log # Mistral agent specific
```

### **Error Handling & Resilience**

- **Graceful Degradation**: Falls back to single-agent mode if collaboration fails
- **Circuit Breaker**: Temporarily disables failing agents
- **Automatic Retry**: Exponential backoff for transient failures
- **Timeout Protection**: Configurable per-agent timeouts

---

## 🛠️ Development Guide

### **Adding a New AI Agent**

**Step 1:** Create agent implementation

```typescript
// src/agents/implementations/openai-agent.ts
import { APIAgent } from '../api-agent';

export class OpenAIAgent extends APIAgent {
  protected async validateCredentials() {
    await this.httpClient.get('/models');
  }

  protected buildAPIRequest(request: AgentRequest) {
    return {
      method: 'POST',
      url: '/chat/completions',
      data: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: request.prompt }]
      }
    };
  }

  protected parseAPIResponse(response: any) {
    return {
      content: response.choices[0].message.content,
      metadata: { tokensUsed: response.usage.total_tokens }
    };
  }
}
```

**Step 2:** Add to `config/agents.yaml`

```yaml
- id: openai-001
  name: "GPT-4 Agent"
  provider: openai
  model: gpt-4
  capabilities: [reasoning, coding, creative]
```

**Step 3:** Register in `src/index.ts`

```typescript
const openaiConfig = agentRegistry.getAgentConfig('openai-001');
const openaiAgent = new OpenAIAgent(openaiConfig);
await openaiAgent.initialize();
agentRegistry.registerAgent(openaiAgent);
```

### **Creating Custom Collaboration Strategies**

```typescript
// Add to collaboration-manager.ts
private async executeCustomStrategy(session: CollaborationSession) {
  // Your custom logic here
  // Example: Round-robin with voting
  const votes = await this.collectAgentVotes(session);
  const winner = this.determineWinner(votes);
  return winner;
}
```

### **Testing**

```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# Coverage report
npm run test:coverage
```

---

### **Production Checklist**

**Environment Configuration:**
- [ ] Set `NODE_ENV=production`
- [ ] Generate strong `JWT_SECRET` (32+ chars)
- [ ] Generate secure `MCP_SECRET_KEY`
- [ ] Configure all AI provider API keys
- [ ] Set proper `DATABASE_URL` with SSL

**Security:**
- [ ] Enable HTTPS/WSS with valid SSL certificates
- [ ] Configure CORS whitelist (remove `*`)
- [ ] Implement rate limiting per IP/user
- [ ] Enable request size limits
- [ ] Set up firewall rules (only ports 80, 443)
- [ ] Use environment variables, never hardcode secrets

**Monitoring & Logging:**
- [ ] Set up log rotation (logrotate or PM2)
- [ ] Configure centralized logging (ELK stack)
- [ ] Set up monitoring (Prometheus + Grafana)
- [ ] Configure alerting for errors/downtime
- [ ] Enable APM (Application Performance Monitoring)

**Database:**
- [ ] Enable PostgreSQL connection pooling
- [ ] Set up automated backups
- [ ] Configure read replicas for scalability
- [ ] Enable query logging for optimization

**Performance:**
- [ ] Enable gzip compression in Nginx
- [ ] Set up CDN for static assets
- [ ] Configure HTTP/2
- [ ] Implement Redis for session management
- [ ] Enable database query caching

**Resilience:**
- [ ] Configure auto-restart (PM2 or systemd)
- [ ] Set up health check endpoints
- [ ] Implement circuit breakers for external APIs
- [ ] Configure retry logic with exponential backoff
- [ ] Set up graceful shutdown handlers

## 🔒 Security Best Practices

- **API Key Management**: All keys stored in environment variables, never in code
- **JWT Authentication**: Secure token-based auth with configurable expiration
- **Request Validation**: Input sanitization and schema validation
- **Rate Limiting**: Per-endpoint throttling to prevent abuse
- **Audit Logging**: Complete task history with timestamps and user tracking
- **CORS Configuration**: Whitelist trusted origins only

## 🤝 Contributing

We welcome contributions! Loomiq is built to be extensible and community-driven.

### **Ways to Contribute**

- 🐛 **Report Bugs**: Open detailed issues with reproduction steps
- 💡 **Suggest Features**: Propose new collaboration strategies or integrations
- 📝 **Improve Docs**: Help make documentation clearer
- 🔧 **Submit PRs**: Fix bugs, add features, or optimize performance
- 🧪 **Write Tests**: Increase test coverage
- 🎨 **Build UI**: Create dashboards or monitoring tools

### **Development Setup**

```bash
# Fork and clone
git clone https://github.com/yourusername/loomiq.git
cd loomiq

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Start development server with hot reload
npm run dev

# Run tests
npm test

# Run linter
npm run lint

# Format code
npm run format
```

### **Project Structure Guidelines**

- **agents/** - Each AI provider gets its own implementation file
- **collaboration/** - Keep strategies modular and testable
- **communication/** - MCP-related code only
- **orchestration/** - Core business logic
- **interfaces/** - TypeScript types (strict typing required)

### **Code Style**

```typescript
// ✅ Good: Clear naming, proper error handling
async function executeTask(taskId: string): Promise<AgentResponse> {
  try {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const result = await this.processTask(task);
    return result;
  } catch (error) {
    this.logger.error('Task execution failed', { taskId, error });
    throw error;
  }
}

// ❌ Bad: Unclear naming, no error handling
async function exec(id: string) {
  const t = this.get(id);
  return this.process(t);
}
```

### **Commit Message Convention**

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
feat: add OpenAI GPT-4 agent implementation
fix: resolve MCP reconnection issue on network drop
docs: update API documentation with new endpoints
refactor: optimize agent selection algorithm
test: add unit tests for collaboration manager
chore: upgrade dependencies to latest versions
```

### **Pull Request Process**

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/add-openai-agent
   ```

2. **Make Your Changes**
   - Write clean, documented code
   - Add tests for new features
   - Update README if needed

3. **Test Locally**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

4. **Commit with Clear Message**
   ```bash
   git add .
   git commit -m "feat: add OpenAI agent with streaming support"
   ```

5. **Push and Open PR**
   ```bash
   git push origin feature/add-openai-agent
   ```
   - Fill out the PR template
   - Link related issues
   - Request review from maintainers

6. **Address Review Feedback**
   - Make requested changes
   - Push updates to the same branch
   - PR will auto-update

### **Adding a New AI Provider**

**1. Create agent implementation:**

```typescript
// src/agents/implementations/openai-agent.ts
import { APIAgent } from '../api-agent';
import { AgentConfig, AgentRequest } from '../../interfaces/agent.interface';

export class OpenAIAgent extends APIAgent {
  private model: string = 'gpt-4';
  
  protected async validateCredentials() {
    await this.httpClient.get('/models');
  }

  protected buildAPIRequest(request: AgentRequest) {
    return {
      method: 'POST',
      url: '/chat/completions',
      data: {
        model: this.model,
        messages: [{ role: 'user', content: request.prompt }],
        temperature: 0.7
      }
    };
  }

  protected parseAPIResponse(response: any, request: AgentRequest) {
    return {
      content: response.choices[0].message.content,
      metadata: {
        tokensUsed: response.usage.total_tokens,
        cost: this.calculateCost(response.usage.total_tokens)
      }
    };
  }
}
```

**2. Add to agent config:**

```yaml
# config/agents.yaml
agents:
  - id: openai-001
    name: "GPT-4 Agent"
    provider: openai
    model: gpt-4
    endpoint: https://api.openai.com/v1
    capabilities: [coding, reasoning, creative]
    cost:
      perToken: 0.00003
```

**3. Register in main file:**

```typescript
// src/index.ts
import { OpenAIAgent } from './agents/implementations/openai-agent';

const openaiConfig = agentRegistry.getAgentConfig('openai-001');
if (openaiConfig) {
  const openaiAgent = new OpenAIAgent(openaiConfig);
  await openaiAgent.initialize();
  agentRegistry.registerAgent(openaiAgent);
  communicationHub.registerAgent(openaiConfig.id);
  logger.info('✅ OpenAI agent registered');
}
```

**4. Add tests:**

```typescript
// tests/agents/openai-agent.test.ts
describe('OpenAIAgent', () => {
  it('should execute tasks successfully', async () => {
    const agent = new OpenAIAgent(mockConfig);
    await agent.initialize();
    
    const response = await agent.execute({
      taskId: 'test-1',
      prompt: 'Hello world'
    });
    
    expect(response.success).toBe(true);
    expect(response.result).toBeDefined();
  });
});
```

### **Testing Guidelines**

- **Unit Tests**: Test individual functions in isolation
- **Integration Tests**: Test agent-orchestrator interaction
- **E2E Tests**: Test full collaboration workflows

```bash
# Run specific test suite
npm test -- agents

# Run with coverage
npm run test:coverage

# Watch mode for development
npm test -- --watch
```

### **Documentation Standards**

- All public methods must have JSDoc comments
- README updates for new features
- API endpoint documentation with examples
- Architecture diagrams for major changes

### **Code Review Checklist**

Reviewers will check for:

- [ ] Code follows TypeScript best practices
- [ ] Proper error handling and logging
- [ ] Tests included for new features
- [ ] Documentation updated
- [ ] No hardcoded secrets or API keys
- [ ] Performance considerations addressed
- [ ] Backward compatibility maintained

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Inspired by distributed computing patterns and multi-agent systems research
- Built with TypeScript, Express.js, Winston, and Axios
- AI providers: Groq, Mistral AI, OpenAI, Anthropic

---

## 📞 Contact & Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/Aayush-engineer/LoomIQ/issues)
- **Email**: aayushkumarsingh245@gmail.com

---

<div align="center">

### ⭐ If you find Loomiq useful, please give it a star on GitHub! ⭐

**Built with ❤️ for the future of collaborative AI**

[⬆ Back to Top](#-loomiq---multi-agent-ai-orchestration-platform)

</div>

