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
import { TaskOrchestrator } from './orchestration/task-orchestratortask-orchestrator';
dotenv.config();


const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.File({ filename: 'orchestrator.log' })
  ]
});


async function main() {
  logger.info('Starting loomiq system');

  const db = DatabaseService.getInstance();
  try {
    await db.initialize();
    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    process.exit(1);
  }

  const app = express();
  const httpServer = createServer(app);
  const port = process.env.PORT || 3000;

  const communicationHub = new CommunicationHubImplementation();
  await communicationHub.initialize(4000);

  const agentRegistry = new AgentRegistry();
  const configPath = path.join(__dirname, '../config/agents.yaml');
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

  const taskOrchestrator = new TaskOrchestrator(agentRegistry, communicationHub);

  // express middleware
  app.use(express.json());

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // Initialize auth service
  const authService = new AuthService(process.env.JWT_SECRET);
  const authMiddleware = createAuthMiddleware(authService);
  const legacyAuthRoutes = createAuthRoutes(authService);

 
  app.use('/api/legacy-auth', legacyAuthRoutes); // No auth

  app.post('/api/tasks', async (req, res) => {
    try {
      const { prompt, type, priority, context, useCollaboration } = req.body;
      
      const task = await taskOrchestrator.createTask({
        prompt,
        type: type || 'implementation',
        priority: priority || 'medium',
        context,
        useCollaboration
      });

      console.log("this is my data comming from user",task);
      
      const result = await taskOrchestrator.executeTask(task.id, useCollaboration);
      
      res.json({ 
        success: true,
        task, 
        result 
      });
    } catch (error) {
      logger.error('Task execution failed', error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Get task status
  app.get('/api/tasks/:taskId', async (req, res) => {
    try {
      const task = taskOrchestrator.getTask(req.params.taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json({ task });
    } catch (error) {
      logger.error('Failed to get task', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Get all tasks
  app.get('/api/tasks', async (req, res) => {
    try {
      const { status, type, priority } = req.query;
      const tasks = await taskOrchestrator.getTasks({
        status: status as any,
        type: type as any,
        priority: priority as any
      });
      res.json({ tasks });
    } catch (error) {
      logger.error('Failed to get tasks', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Get orchestrator stats
  app.get('/api/stats', async (req, res) => {
    try {
      const stats = taskOrchestrator.getStats();
      res.json({ stats });
    } catch (error) {
      logger.error('Failed to get stats', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Get agent health
  app.get('/api/agents', async (req, res) => {
    try {
      const agents = agentRegistry.getAllAgents().map(agent => ({
        id: agent.config.id,
        name: agent.config.name,
        provider: agent.config.provider,
        status: agent.getStatus(),
        capabilities: agent.getCapabilities()
      }));
      res.json({ agents });
    } catch (error) {
      logger.error('Failed to get agents', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  app.post('/api/tasks/:id/collaborate', async (req, res) => {
    try {
      const task = taskOrchestrator.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      
      const result = await taskOrchestrator.executeTask(task.id, true);
      res.json({ task, result });
    } catch (error) {
      logger.error('Collaboration execution failed', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime()
    });
  });

  
  httpServer.listen(port, () => {
    logger.info(`Orchestrator API listening on port ${port}`);
  });
  
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await db.close();
    httpServer.close();
    process.exit(0);
  });

}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});



