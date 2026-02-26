import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import winston from 'winston';
import { DatabaseService } from './database/database-service';
import { AuthService } from './services/auth-service';          
import { createAuthMiddleware } from './middleware/auth-middleware';
import { createAuthRoutes } from './routes/auth-routes';
import { CommunicationHubImplementation } from './communication/communication-hub';
import { AgentRegistry } from './agents/agent-registry';
import path from 'path';
import { GroqAgent } from './agents/implementations/groq-agent';
import { MistralAgent } from './agents/implementations/Mistral-agent';
import { TaskOrchestrator } from './orchestration/task-orchestrator'; 
import { z } from 'zod';

dotenv.config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: 'orchestrator.log' }),
  ],
});


const CreateTaskSchema = z.object({
  prompt:           z.string().min(5).max(10000),
  type:             z.enum(['implementation','design','test','review','deployment','requirement']).optional(),
  priority:         z.enum(['low','medium','high','critical']).optional(),
  useCollaboration: z.boolean().optional().default(false),
});

async function main() {
  logger.info('Starting LoomIQ system');

  // DATABASE
  const db = DatabaseService.getInstance();
  try {
    await db.initialize();
    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    process.exit(1);
  }

  // AUTH
  const authService    = new AuthService(db, process.env.JWT_SECRET);
  const authMiddleware = createAuthMiddleware(authService);
  const legacyAuthRoutes = createAuthRoutes(authService);

  // Agents & Communication 
  const app        = express();
  const httpServer = createServer(app);
  const port       = Number(process.env.PORT) || 3000;
  const mcp_port   = Number(process.env.MCP_PORT) || 4000;

  const communicationHub = new CommunicationHubImplementation();
  await communicationHub.initialize(mcp_port);

  const agentRegistry = new AgentRegistry();
  const configPath    = path.join(__dirname, '../config/agents.yaml');
  await agentRegistry.loadConfigurations(configPath);

  const groqConfig = agentRegistry.getAgentConfig('groq-001');
  if (groqConfig) {
    const groqAgent = new GroqAgent(groqConfig);
    await groqAgent.initialize();
    agentRegistry.registerAgent(groqAgent);
    communicationHub.registerAgent(groqConfig.id);
    logger.info('✅ Groq agent registered');
  }

  const mistralConfig = agentRegistry.getAgentConfig('mistral-001');
  if (mistralConfig) {
    const mistralAgent = new MistralAgent(mistralConfig);
    await mistralAgent.initialize();
    agentRegistry.registerAgent(mistralAgent);
    communicationHub.registerAgent(mistralConfig.id);
    logger.info('✅ Mistral agent registered');
  }

  // Orchestrator 
  const taskOrchestrator = new TaskOrchestrator(agentRegistry, communicationHub, db);



  // Express middleware 
  app.use(express.json());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });


  // SSE auth 
  const sseAuth = async (req: any, res: any, next: any) => {
    try {
      let token: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      } else if (req.query.token) {
        token = req.query.token as string;
      }
      if (!token) return res.status(401).json({ error: 'Missing token' });
      const payload = await authService.verifyToken(token);
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };

  // SSE stream route 
  app.get('/api/tasks/:taskId/stream', sseAuth, (req, res) => {
    const { taskId } = req.params;

    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: string, data: object) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    send('connected', { taskId, timestamp: new Date() });
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);

    const onAssigned = ({ task, agent }: any) => {
      if (task.id !== taskId) return;
      send('task:assigned', { message: `Task assigned to ${agent.name}`, agentName: agent.name, timestamp: new Date() });
    };
    const onCompleted = ({ task, collaboration }: any) => {
      if (task.id !== taskId) return;
      send('task:completed', {
        message: collaboration ? 'Multi-agent collaboration completed ✓' : 'Task completed successfully ✓',
        duration: task.actualDuration, timestamp: new Date(),
      });
      cleanup();
    };
    const onFailed = ({ task, error }: any) => {
      if (task.id !== taskId) return;
      send('task:failed', { message: `Task failed: ${error?.message ?? error}`, timestamp: new Date() });
      cleanup();
    };
    const onTaskError = ({ task, error }: any) => {
      if (task.id !== taskId) return;
      send('task:error', { message: `Error: ${error instanceof Error ? error.message : String(error)}`, timestamp: new Date() });
      cleanup();
    };
    const onCollabStarted = ({ task: t, sessionId, strategy }: any) => {
      if (t.id !== taskId) return;
      send('collaboration:started', { message: `Collaboration started — ${strategy}`, sessionId, strategy, timestamp: new Date() });
    };
    const collabManager = (taskOrchestrator as any).collaborationManager;
    const onStepStarted   = ({ session, step }: any) => { if (session.taskId !== taskId) return; const a = agentRegistry.getAgent(step.assignedAgent); send('step:started',   { message: `▶  Step "${step.name}" started`, agentName: a?.config?.name ?? step.assignedAgent, stepId: step.id, timestamp: new Date() }); };
    const onStepCompleted = ({ session, step, result }: any) => { if (session.taskId !== taskId) return; send('step:completed', { message: `✓  Step "${step.name}" completed`, stepId: step.id, duration: result.duration, timestamp: new Date() }); };
    const onStepFailed    = ({ session, step, error }: any) => { if (session.taskId !== taskId) return; send('step:failed',    { message: `✗  Step "${step.name}" failed: ${error?.message ?? error}`, stepId: step.id, timestamp: new Date() }); };

    taskOrchestrator.on('task:assigned',         onAssigned);
    taskOrchestrator.on('task:completed',        onCompleted);
    taskOrchestrator.on('task:failed',           onFailed);
    taskOrchestrator.on('task:error',            onTaskError);
    taskOrchestrator.on('collaboration:started', onCollabStarted);
    if (collabManager) {
      collabManager.on('step:started',   onStepStarted);
      collabManager.on('step:completed', onStepCompleted);
      collabManager.on('step:failed',    onStepFailed);
    }

    function cleanup() {
      clearInterval(keepAlive);
      taskOrchestrator.off('task:assigned',         onAssigned);
      taskOrchestrator.off('task:completed',        onCompleted);
      taskOrchestrator.off('task:failed',           onFailed);
      taskOrchestrator.off('task:error',            onTaskError);
      taskOrchestrator.off('collaboration:started', onCollabStarted);
      if (collabManager) {
        collabManager.off('step:started',   onStepStarted);
        collabManager.off('step:completed', onStepCompleted);
        collabManager.off('step:failed',    onStepFailed);
      }
      if (!res.writableEnded) res.end();
    }
    req.on('close', cleanup);
  });

  // Auth routes (public) 
  app.use('/api/legacy-auth', legacyAuthRoutes);

  // Task routes (protected) 
  app.post('/api/tasks', authMiddleware.authenticate, async (req, res) => {
    try {
      const { prompt, type, priority, context, useCollaboration } = req.body;

      const parsed = CreateTaskSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ errors: parsed.error.flatten() });
      
      const organizationId = (req as any).user?.organizationId 
      || (req as any).user?.orgId
      || process.env.DEFAULT_ORG_ID;
      const task = await taskOrchestrator.createTask({ prompt, type, priority, context,organizationId });

      res.json({ success: true, task, result: null });

      taskOrchestrator.executeTask(task.id, useCollaboration).catch(err =>
        logger.error('Background task execution failed', err)
      );
    } catch (error) {
      logger.error('Task creation failed', error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/tasks/:taskId', authMiddleware.authenticate, async (req, res) => {
    try {
      const task = await taskOrchestrator.getTask(req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json({ task });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/tasks', authMiddleware.authenticate, async (req, res) => {
    try {
      const { status, type, priority } = req.query;
      const tasks = await taskOrchestrator.getTasks({ status, type, priority } as any);
      res.json({ tasks });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/stats', authMiddleware.authenticate, async (req, res) => {
    try {
      const stats = await taskOrchestrator.getFullStats();
      res.json({ stats });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/agents', authMiddleware.authenticate, async (req, res) => {
    try {
      const agents = agentRegistry.getAllAgents().map(a => ({
        id: a.config.id, name: a.config.name, provider: a.config.provider,
        status: a.getStatus(), capabilities: a.getCapabilities(),
      }));
      res.json({ agents });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date(), uptime: process.uptime() });
  });

  // Start server 
  httpServer.listen(port, '0.0.0.0', () => {
    logger.info(`Orchestrator API listening on port ${port}`);
  });


  // Graceful shutdown 
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    taskOrchestrator.stopTaskProcessor();           // ← stop interval FIRST
    const agents = agentRegistry.getAllAgents();
    for (const agent of agents) await agent.shutdown();
    await communicationHub.shutdown();
    await db.close();
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);     // force exit after 10s
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});