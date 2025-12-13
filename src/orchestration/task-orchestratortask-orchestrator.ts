import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { AgentRegistry } from '../agents/agent-registry';
import { CommunicationHubImplementation } from '../communication/communication-hub';
import { 
  Task
} from '../interfaces/task.interface';
import { AgentRequest } from '../interfaces/agent.interface';
import { CollaborationManager, CollaborationStrategy } from '../collaboration/collaboration-manager';
import winston from 'winston';

export class TaskOrchestrator extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private taskQueue: Task[] = [];
  private runningTasks: Map<string, { agentId: string, startTime: Date }> = new Map();
  private logger: winston.Logger;
  private collaborationManager: CollaborationManager;
  private taskProcessorInterval: NodeJS.Timeout | null = null;

  constructor(
    private agentRegistry: AgentRegistry,
    private communicationHub: CommunicationHubImplementation
  ) {
    super();
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });
    this.collaborationManager = new CollaborationManager(agentRegistry, communicationHub);
    this.setupCollaborationHandlers();

    this.startTaskProcessor();
  }

  private setupCollaborationHandlers(): void {
    this.collaborationManager.on('session:completed', (session) => {
      this.logger.info(`Collaboration session ${session.id} completed for task ${session.taskId}`);
      
      const task = this.tasks.get(session.taskId);
      if (task && session.results.length > 0) {
        task.output = session.results;
        task.status = 'completed';
        task.completedAt = new Date();
        this.emit('task:completed', { task, collaboration: true });
      }
    });

    this.collaborationManager.on('session:failed', ({ session, error }) => {
      this.logger.error(`Collaboration session ${session.id} failed:`, error);
      
      const task = this.tasks.get(session.taskId);
      if (task) {
        task.status = 'failed';
        task.error = error.message;
        this.emit('task:failed', { task, error, collaboration: true });
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
  }): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      projectId: params.projectId || '',
      type: params.type || 'implementation',
      title: this.generateTaskTitle(params.prompt),
      description: params.prompt,
      dependencies: params.dependencies || [],
      status: 'pending',
      priority: params.priority || 'medium',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: params.context
    };

    this.tasks.set(task.id, task);
    this.taskQueue.push(task);
    this.sortTaskQueue();
    
    this.logger.info(`Task created: ${task.id} - ${task.title}`);
    this.emit('task:created', task);
    
    return task;
  }

  public async executeTask(taskId: string, useCollaboration: boolean = false): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Check if task requires collaboration
    if (useCollaboration || this.requiresCollaboration(task)) {
      return this.executeTaskWithCollaboration(task);
    }

    // Get eligible agents for the task
    const agentScores = this.agentRegistry.findBestAgentForTask(task);
    if (agentScores.length === 0) {
      throw new Error('No suitable agent found');
    }

    const bestAgentId = agentScores[0].agentId;
    const bestAgent = this.agentRegistry.getAgent(bestAgentId);

    if (!bestAgent) {
      throw new Error('Agent not found');
    }

    task.assignedAgent = bestAgent.config.id;
    task.status = 'assigned';
    task.startedAt = new Date();
    
    this.runningTasks.set(taskId, {
      agentId: bestAgent.config.id,
      startTime: new Date()
    });

    this.logger.info(`Task ${taskId} assigned to agent ${bestAgent.config.name}`);
    this.emit('task:assigned', { task, agent: bestAgent.config });

    try {
      task.status = 'in_progress';
      
      const request: AgentRequest = {
        taskId,
        prompt: task.description,
        context: task.metadata,
        priority: task.priority
      };

      const response = await bestAgent.execute(request);
      
      if (response.success) {
        task.status = 'completed';
        task.output = response.result;
        task.completedAt = new Date();
        task.actualDuration = response.duration;
        
        this.logger.info(`Task ${taskId} completed successfully`);
        this.emit('task:completed', { task, response });
      } else {
        task.status = 'failed';
        task.error = response.error;
        
        this.logger.error(`Task ${taskId} failed: ${response.error}`);
        this.emit('task:failed', { task, error: response.error });
      }

      return response;
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error(`Task ${taskId} execution error:`, error);
      this.emit('task:error', { task, error });
      
      // Return a failed response instead of throwing
      return {
        taskId: task.id,
        agentId: bestAgent.config.id,
        success: false,
        status: 'failed',
        error: task.error,
        duration: Date.now() - (task.startedAt?.getTime() || Date.now())
      };
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  private startTaskProcessor(): void {
    this.taskProcessorInterval = setInterval(() => {
      this.processPendingTasks();
    }, 5000);
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

    const maxConcurrentTasks = parseInt(process.env.MAX_CONCURRENT_TASKS || '10');
    if (this.runningTasks.size >= maxConcurrentTasks) return;

    const pendingTasks = this.taskQueue.filter(task => {
      if (task.status !== 'pending') return false;
      
      if (task.dependencies && task.dependencies.length > 0) {
        const allDependenciesCompleted = task.dependencies.every(depId => {
          const depTask = this.tasks.get(depId);
          return depTask && depTask.status === 'completed';
        });
        if (!allDependenciesCompleted) return false;
      }
      
      return true;
    });

    for (const task of pendingTasks) {
      if (this.runningTasks.size >= maxConcurrentTasks) break;
      
      try {
        await this.executeTask(task.id);
      } catch (error) {
        this.logger.error(`Failed to execute task ${task.id}:`, error);
      }
    }
  }

  private sortTaskQueue(): void {
    this.taskQueue.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private generateTaskTitle(prompt: string): string {
    const firstLine = prompt.split('\n')[0];
    const title = firstLine.substring(0, 100);
    return title.length < firstLine.length ? title + '...' : title;
  }

  public getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  public updateTask(taskId: string, updates: Partial<Task>): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }
    
    const updatedTask = {
      ...task,
      ...updates,
      id: task.id, // Prevent ID change
      updatedAt: new Date()
    };
    
    this.tasks.set(taskId, updatedTask);
    this.emit('task:updated', { task: updatedTask });
    
    return updatedTask;
  }

  public deleteTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    
    this.tasks.delete(taskId);
    this.emit('task:deleted', { taskId });
    
    return true;
  }

  public getRunningTasks(): Map<string, { agentId: string, startTime: Date }> {
    return new Map(this.runningTasks);
  }

  public async getTasks(filters?: {
    status?: Task['status'];
    type?: Task['type'];
    priority?: Task['priority'];
  }): Promise<Task[]> {
    let tasks = Array.from(this.tasks.values());
    
    if (filters) {
      if (filters.status) {
        tasks = tasks.filter(task => task.status === filters.status);
      }
      if (filters.type) {
        tasks = tasks.filter(task => task.type === filters.type);
      }
      if (filters.priority) {
        tasks = tasks.filter(task => task.priority === filters.priority);
      }
    }
    
    return tasks;
  }

  private requiresCollaboration(task: Task): boolean {
    
    const complexityKeywords = [
      'review', 'validate', 'compare', 'multiple perspectives',
      'complex', 'full stack', 'comprehensive', 'end-to-end',
      'integrate', 'coordinate', 'collaborate','multiple agents',
      'cross-functional',
      'full stack',
      'end-to-end',
      'comprehensive',
      'integrate',
      'coordinate'
    ];

    const description = task.description.toLowerCase();
    const hasComplexityIndicator = complexityKeywords.some(indicator => 
      description.includes(indicator)
    );

    // High priority complex tasks benefit from collaboration
    const isHighComplexity = task.priority === 'critical' || 
      (task.priority === 'high' && hasComplexityIndicator);

    return isHighComplexity || hasComplexityIndicator;
  }

  private async executeTaskWithCollaboration(task: Task): Promise<any> {
  this.logger.info(`🤝 Executing task ${task.id} with collaboration`);

  // ✅ Set startedAt BEFORE any async operations
  if (!task.startedAt) {
    task.startedAt = new Date();
  }

  // Determine collaboration strategy
  const strategy = this.determineCollaborationStrategy(task);

  try {
    // Create collaboration session
    const session = await this.collaborationManager.createCollaborationSession(task, strategy);
    
    task.status = 'in_progress';
    task.metadata = {
      ...task.metadata,
      collaborationSessionId: session.id,
      collaborationAgents: session.agents,
      collaborationStrategy: strategy.type
    };

    this.emit('collaboration:started', { 
      task, 
      sessionId: session.id,
      strategy: strategy.type 
    });

    // Execute collaboration
    const results = await this.collaborationManager.executeCollaborationSession(session.id);
    
    // Process results
    const synthesizedResult = this.synthesizeCollaborationResults(results);
    
    task.status = 'completed';
    task.output = synthesizedResult;
    task.completedAt = new Date();
    
    // ✅ Safe duration calculation
    task.actualDuration = task.startedAt 
      ? Date.now() - task.startedAt.getTime() 
      : 0;

    this.logger.info(`✅ Task ${task.id} completed with collaboration in ${task.actualDuration}ms`);

    // Emit success event
    this.emit('task:completed', { task, collaboration: true });

    return {
      taskId: task.id,
      success: true,
      collaborationSession: session.id,
      results: synthesizedResult,
      duration: task.actualDuration
    };

  } catch (error) {
    task.status = 'failed';
    task.error = error instanceof Error ? error.message : 'Collaboration failed';
    
    // ✅ Safe duration calculation on error
    if (task.startedAt) {
      task.actualDuration = Date.now() - task.startedAt.getTime();
    } else {
      task.actualDuration = 0;
    }
    
    this.logger.error(`❌ Task ${task.id} collaboration failed:`, error);
    this.emit('task:error', { task, error });
    
    // Return error response instead of throwing
    return {
      taskId: task.id,
      success: false,
      error: task.error,
      duration: task.actualDuration
    };
  }
}

  private determineCollaborationStrategy(task: Task): CollaborationStrategy {
    const description = task.description.toLowerCase();

    // Consensus for design and architecture decisions
    if (task.type === 'design' || description.includes('architecture')) {
      return { type: 'consensus', config: {} };
    }

    // Parallel for independent components
    if (description.includes('frontend') && description.includes('backend')) {
      return { type: 'parallel', config: {} };
    }

    // Hierarchical for complex multi-step tasks
    if (task.priority === 'critical' || (task.requirements && task.requirements.length > 5)) {
      return { type: 'hierarchical', config: {} };
    }

    // Default to sequential
    return { type: 'sequential', config: {} };
  }

  private synthesizeCollaborationResults(results: any[]): any {
    // Combine results from multiple agents
    const synthesis = {
      summary: 'Task completed through multi-agent collaboration',
      results: results,
      combinedOutput: {},
      metadata: {
        agentCount: new Set(results.map(r => r.agentId)).size,
        totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
        timestamp: new Date()
      }
    };

    // Merge outputs
    for (const result of results) {
      if (result.output && typeof result.output === 'object') {
        Object.assign(synthesis.combinedOutput, result.output);
      }
    }

    return synthesis;
  }

  public getCollaborationSessions() {
    return this.collaborationManager.getAllSessions();
  }

  public getCollaborationSession(sessionId: string) {
    return this.collaborationManager.getSession(sessionId);
  }

  public getStats() {
    const tasks = Array.from(this.tasks.values());
    const collaborativeTasks = tasks.filter(t => t.metadata?.useCollaboration);
    
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      running: this.runningTasks.size,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      collaborative: collaborativeTasks.length,
      collaborationSessions: this.collaborationManager.getAllSessions().length,
      averageDuration: this.calculateAverageDuration(tasks)
    };
  }

  private calculateAverageDuration(tasks: Task[]): number {
    const completedTasks = tasks.filter(t => t.status === 'completed' && t.actualDuration);
    if (completedTasks.length === 0) return 0;
    
    const total = completedTasks.reduce((sum, t) => sum + (t.actualDuration || 0), 0);
    return Math.round(total / completedTasks.length);
  }
 
}