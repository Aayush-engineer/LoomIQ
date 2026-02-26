import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { AgentRegistry } from '../agents/agent-registry';
import { CommunicationHubImplementation } from '../communication/communication-hub';
import { Task } from '../interfaces/task.interface';
import { AgentRequest } from '../interfaces/agent.interface';
import { CollaborationManager, CollaborationStrategy } from '../collaboration/collaboration-manager';
import { DatabaseService } from '../database/database-service';
import winston from 'winston';

// Retry config 
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs:  1_000,   
  maxDelayMs:  30_000,   
  backoffFactor: 2,      
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffFactor, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}


export class TaskOrchestrator extends EventEmitter {
  
  private runningTasks: Map<string, { agentId: string; startTime: Date; attempts: number }> = new Map();
  private executionLock: Set<string> = new Set();
  private logger: winston.Logger;
  private collaborationManager: CollaborationManager;
  private taskProcessorInterval: NodeJS.Timeout | null = null;
  private db: DatabaseService;

  constructor(
    private agentRegistry: AgentRegistry,
    private communicationHub: CommunicationHubImplementation,
    db: DatabaseService
  ) {
    super();
    this.db = db;

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports: [new winston.transports.Console({ format: winston.format.simple() })]
    });

    this.collaborationManager = new CollaborationManager(agentRegistry, communicationHub);
    this.setupCollaborationHandlers();
    this.startTaskProcessor();
  }

  
  private setupCollaborationHandlers(): void {
    this.collaborationManager.on('session:completed', async (session) => {
      const task = await this.db.tasks.findById(session.taskId);
      if (task && session.results.length > 0) {
        await this.db.tasks.updateTaskStatus(session.taskId, 'completed', {
          output: session.results,
          completedAt: new Date(),
        });
        const updated = await this.db.tasks.findById(session.taskId);
        this.emit('task:completed', { task: updated, collaboration: true });
      }
    });

    this.collaborationManager.on('session:failed', async ({ session, error }) => {
      this.logger.error(`Collaboration session ${session.id} failed:`, error);
      const task = await this.db.tasks.findById(session.taskId);
      if (task) {
        await this.db.tasks.updateTaskStatus(session.taskId, 'failed', {
          error: error.message,
        });
        const updated = await this.db.tasks.findById(session.taskId);
        this.emit('task:failed', { task: updated, error, collaboration: true });
      }
    });
  }

 
  public async createTask(params: {
    prompt: string;
    type?: Task['type'];
    priority?: Task['priority'];
    context?: any;
    projectId?: string;
    dependencies?: string[];
    organizationId: string;
  }): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      organizationId: params.organizationId || process.env.DEFAULT_ORG_ID || null,
      projectId: params.projectId || null,
      type: params.type || 'implementation',
      title: this.generateTaskTitle(params.prompt),
      description: params.prompt,
      dependencies: params.dependencies || [],
      status: 'pending',
      priority: params.priority || 'medium',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: params.context,
    };

    
    await this.db.tasks.create(task as any);

    this.logger.info(`Task created: ${task.id} - ${task.title}`);
    this.emit('task:created', task);
    return task;
  }

  
  public async executeTask(taskId: string, useCollaboration: boolean = false): Promise<any> {
    
    if (this.executionLock.has(taskId)) {
      this.logger.warn(`Task ${taskId} is already queued/running — skipping duplicate execution`);
      return null;
    }
    if (this.runningTasks.has(taskId)) {
      this.logger.warn(`Task ${taskId} is already in progress — skipping`);
      return null;
    }

    this.executionLock.add(taskId);

    try {
      const dbTask = await this.db.tasks.findById(taskId);
      if (!dbTask) throw new Error('Task not found');

      const task = dbTask as unknown as Task;

      if (useCollaboration || this.requiresCollaboration(task)) {
        return await this.executeTaskWithCollaboration(task);
      }
      return await this.executeTaskWithRetry(task);

    } finally {
      this.executionLock.delete(taskId);
    }
  }

  
  private async executeTaskWithRetry(task: Task): Promise<any> {
    const agentScores = this.agentRegistry.findBestAgentForTask(task);
    if (agentScores.length === 0) throw new Error('No suitable agent found');

    const bestAgent = this.agentRegistry.getAgent(agentScores[0].agentId);
    if (!bestAgent) throw new Error('Agent not found');

    const { Agent: AgentEntity } = await import('../database/entities/Agent');
    const agentRepo = this.db.getRepository(AgentEntity);
    const agentRecord = await agentRepo.findOne({ 
      where: { agentId: bestAgent.config.id }  
    });

    if (!agentRecord) {
      this.logger.warn(`Agent ${bestAgent.config.id} not found in DB — proceeding without FK assignment`);
    }

    const dbAgentId = agentRecord?.id ?? null; 
    
    if (dbAgentId) {
      await this.db.tasks.update(task.id, { assignedAgentId: dbAgentId } as any);
    }

    
    await this.db.tasks.updateTaskStatus(task.id, 'assigned', { startedAt: new Date() });

    
    await this.db.tasks.update(task.id, {
      metadata: {
        ...((task.metadata as any) || {}),
        assignedAgentId:   bestAgent.config.id,
        assignedAgentName: bestAgent.config.name,
        assignedProvider:  bestAgent.config.provider,
      }
    } as any);

    this.runningTasks.set(task.id, {
      agentId: bestAgent.config.id,
      startTime: new Date(),
      attempts: 0,
    });

    this.logger.info(`Task ${task.id} assigned to agent ${bestAgent.config.name}`);
    this.emit('task:assigned', { task: { ...task, assignedAgent: bestAgent.config.id }, agent: bestAgent.config });

    let lastError: any;

    for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
      const runInfo = this.runningTasks.get(task.id);
      if (runInfo) runInfo.attempts = attempt + 1;

      try {
        await this.db.tasks.updateTaskStatus(task.id, 'in_progress');

        const request: AgentRequest = {
          taskId: task.id,
          prompt: task.description,
          context: task.metadata,
          priority: task.priority,
        };

        const response = await bestAgent.execute(request);

        if (response.success) {
          const duration = Date.now() - (this.runningTasks.get(task.id)?.startTime.getTime() ?? Date.now());

          await this.db.tasks.updateTaskStatus(task.id, 'completed', {
            output: response.result,
            actualDuration: response.duration ?? duration,
            completedAt: new Date(),
          });

          this.logger.info(`Task ${task.id} completed successfully (attempt ${attempt + 1})`);
          const completed = await this.db.tasks.findById(task.id);
          this.emit('task:completed', { task: completed, response });
          return response;
        }

        
        lastError = new Error(response.error || 'Agent returned failure');
        this.logger.warn(`Task ${task.id} attempt ${attempt + 1} failed: ${lastError.message}`);

        if (attempt < RETRY_CONFIG.maxAttempts - 1) {
          const delay = retryDelay(attempt);
          this.logger.info(`Retrying task ${task.id} in ${delay}ms (attempt ${attempt + 2}/${RETRY_CONFIG.maxAttempts})`);
          await this.db.tasks.updateTaskStatus(task.id, 'pending'); 
          await sleep(delay);
        }

      } catch (err) {
        lastError = err;
        this.logger.warn(`Task ${task.id} attempt ${attempt + 1} threw: ${(err as Error).message}`);

        if (attempt < RETRY_CONFIG.maxAttempts - 1) {
          const delay = retryDelay(attempt);
          this.logger.info(`Retrying task ${task.id} in ${delay}ms`);
          await this.db.tasks.updateTaskStatus(task.id, 'pending');
          await sleep(delay);
        }
      }
    }

    
    const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
    await this.db.tasks.updateTaskStatus(task.id, 'failed', { error: errMsg });

    this.logger.error(`Task ${task.id} failed after ${RETRY_CONFIG.maxAttempts} attempts`);
    const failed = await this.db.tasks.findById(task.id);
    this.emit('task:failed', { task: failed, error: lastError });

    this.runningTasks.delete(task.id);

    return {
      taskId: task.id,
      agentId: bestAgent.config.id,
      success: false,
      status: 'failed',
      error: errMsg,
      attempts: RETRY_CONFIG.maxAttempts,
    };
  }

  
  private startTaskProcessor(): void {
    this.taskProcessorInterval = setInterval(() => {
      this.processPendingTasks().catch(err =>
        this.logger.error('Task processor error:', err)
      );
    }, 10_000); 
  }

  public stopTaskProcessor(): void {
    if (this.taskProcessorInterval) {
      clearInterval(this.taskProcessorInterval);
      this.taskProcessorInterval = null;
    }
  }

  private async processPendingTasks(): Promise<void> {
    const availableAgents = this.agentRegistry.getAvailableAgents();
    if (availableAgents.length === 0) return;

    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_TASKS || '10');
    if (this.runningTasks.size >= maxConcurrent) return;

    
    const pendingTasks = await this.db.tasks.findPendingTasks(null);

    for (const task of pendingTasks) {
      if (this.runningTasks.size >= maxConcurrent) break;

      
      if (this.executionLock.has(task.id) || this.runningTasks.has(task.id)) continue;

      
      if (task.dependencies && task.dependencies.length > 0) {
        const allDone = await Promise.all(
          task.dependencies.map(async depId => {
            const dep = await this.db.tasks.findById(depId);
            return dep?.status === 'completed';
          })
        );
        if (!allDone.every(Boolean)) continue;
      }

      this.executeTask(task.id).catch(err =>
        this.logger.error(`Processor failed to execute task ${task.id}:`, err)
      );
    }
  }

  
  private async executeTaskWithCollaboration(task: Task): Promise<any> {
    this.logger.info(`🤝 Executing task ${task.id} with collaboration`);

    await this.db.tasks.updateTaskStatus(task.id, 'in_progress', { startedAt: new Date() });
    const startedAt = new Date();

    const strategy = this.determineCollaborationStrategy(task);

    try {
      const session = await this.collaborationManager.createCollaborationSession(task, strategy);

      await this.db.tasks.update(task.id, {
        metadata: {
          ...task.metadata,
          collaborationSessionId: session.id,
          collaborationStrategy: strategy.type,
        },
      } as any);

      this.emit('collaboration:started', { task, sessionId: session.id, strategy: strategy.type });

      const results = await this.collaborationManager.executeCollaborationSession(session.id);
      const synthesized = this.synthesizeCollaborationResults(results);
      const duration = Date.now() - startedAt.getTime();

      await this.db.tasks.updateTaskStatus(task.id, 'completed', {
        output: synthesized,
        actualDuration: duration,
        completedAt: new Date(),
      });

      this.logger.info(`✅ Task ${task.id} collaboration done in ${duration}ms`);
      const completed = await this.db.tasks.findById(task.id);
      this.emit('task:completed', { task: completed, collaboration: true });

      return { taskId: task.id, success: true, results: synthesized, duration };

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Collaboration failed';
      const duration = Date.now() - startedAt.getTime();

      await this.db.tasks.updateTaskStatus(task.id, 'failed', {
        error: errMsg,
        actualDuration: duration,
      });

      this.logger.error(`❌ Task ${task.id} collaboration failed:`, error);
      const failed = await this.db.tasks.findById(task.id);
      this.emit('task:error', { task: failed, error });

      return { taskId: task.id, success: false, error: errMsg, duration };
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  
  private requiresCollaboration(task: Task): boolean {
    const keywords = [
      'review', 'validate', 'compare', 'multiple perspectives',
      'complex', 'comprehensive', 'end-to-end', 'integrate',
      'coordinate', 'collaborate', 'multiple agents', 'cross-functional',
      'full stack',
    ];
    const desc = task.description.toLowerCase();
    const hasKeyword = keywords.some(k => desc.includes(k));
    const isHighPriority = task.priority === 'critical' ||
      (task.priority === 'high' && hasKeyword);
    return isHighPriority || hasKeyword;
  }

  private determineCollaborationStrategy(task: Task): CollaborationStrategy {
    const desc = task.description.toLowerCase();
    if (task.type === 'design' || desc.includes('architecture')) return { type: 'consensus', config: {} };
    if (desc.includes('frontend') && desc.includes('backend')) return { type: 'parallel', config: {} };
    if (task.priority === 'critical') return { type: 'hierarchical', config: {} };
    return { type: 'sequential', config: {} };
  }

  private synthesizeCollaborationResults(results: any[]): any {
    return {
      summary: 'Task completed through multi-agent collaboration',
      results,
      combinedOutput: results.reduce((acc, r) => {
        if (r.output && typeof r.output === 'object') Object.assign(acc, r.output);
        return acc;
      }, {} as any),
      metadata: {
        agentCount: new Set(results.map(r => r.agentId)).size,
        totalDuration: results.reduce((sum, r) => sum + (r.duration || 0), 0),
        timestamp: new Date(),
      },
    };
  }

  private generateTaskTitle(prompt: string): string {
    const first = prompt.split('\n')[0].substring(0, 100);
    return first.length < prompt.split('\n')[0].length ? first + '...' : first;
  }

  
  public async getTask(taskId: string): Promise<Task | undefined> {
    const task = await this.db.tasks.findById(taskId);
    return task as unknown as Task ?? undefined;
  }

  public async getTasks(filters?: {
    status?: Task['status'];
    type?: Task['type'];
    priority?: Task['priority'];
  }): Promise<Task[]> {
    const tasks = await this.db.tasks.findByOrganization(null, filters);
    return tasks as unknown as Task[];
  }

  public getStats(): Record<string, any> {
    return { running: this.runningTasks.size };
  }

  public async getFullStats(): Promise<Record<string, any>> {
    const tasks = await this.db.tasks.findByOrganization(null);
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      running: this.runningTasks.size,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      averageDuration: this.calculateAverageDuration(tasks),
    };
  }

  private calculateAverageDuration(tasks: any[]): number {
    const done = tasks.filter(t => t.status === 'completed' && t.actualDuration);
    if (done.length === 0) return 0;
    return Math.round(done.reduce((s, t) => s + t.actualDuration, 0) / done.length);
  }

  public getRunningTasks() { return new Map(this.runningTasks); }
  public getCollaborationSessions() { return this.collaborationManager.getAllSessions(); }
  public getCollaborationSession(id: string) { return this.collaborationManager.getSession(id); }
}