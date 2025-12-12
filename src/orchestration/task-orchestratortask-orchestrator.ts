import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { AgentRegistry } from '../agents/agent-registry';
import { CommunicationHubImplementation } from '../communication/communication-hub';
import { Task } from '../interfaces/task.interface';
import { AgentRequest } from '../interfaces/agent.interface';
import { CollaborationManager, CollaborationStrategy } from '../collaboration/collaboration-manager';
import winston from 'winston';

export class TaskOrchestrator extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private taskQueue: Task[] = [];
  private runningTasks: Map<string, { agentId: string, startTime: Date }> = new Map();
  private logger: winston.Logger;
  private collaborationManager: CollaborationManager;

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

    // Initialize collaboration manager
    this.collaborationManager = new CollaborationManager(agentRegistry, communicationHub);
    this.setupCollaborationHandlers();
  }

  private setupCollaborationHandlers(): void {
    // Listen to collaboration events
    this.collaborationManager.on('session:completed', (session) => {
      this.logger.info(`🎉 Collaboration session ${session.id} completed`);
      
      const task = this.tasks.get(session.taskId);
      if (task && session.results.length > 0) {
        task.output = {
          collaborationResults: session.results,
          sessionId: session.id,
          strategy: session.plan?.steps?.length > 0 ? 'multi-agent' : 'single-agent'
        };
        task.status = 'completed';
        task.completedAt = new Date();
        this.emit('task:completed', { task, collaboration: true });
      }
    });

    this.collaborationManager.on('session:failed', ({ session, error }) => {
      this.logger.error(`❌ Collaboration session ${session.id} failed:`, error);
      
      const task = this.tasks.get(session.taskId);
      if (task) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : 'Collaboration failed';
        this.emit('task:failed', { task, error, collaboration: true });
      }
    });

    // Forward step events for real-time UI updates
    this.collaborationManager.on('step:started', ({ session, step }) => {
      this.emit('collaboration:step_started', { 
        taskId: session.taskId, 
        stepName: step.name,
        agentId: step.assignedAgent
      });
    });

    this.collaborationManager.on('step:completed', ({ session, step, result }) => {
      this.emit('collaboration:step_completed', { 
        taskId: session.taskId, 
        stepName: step.name,
        result: result.output
      });
    });
  }

  public async createTask(params: {
    prompt: string;
    type?: Task['type'];
    priority?: Task['priority'];
    context?: any;
    useCollaboration?: boolean;
    collaborationStrategy?: CollaborationStrategy;
  }): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      projectId: '',
      type: params.type || 'implementation',
      title: this.generateTaskTitle(params.prompt),
      description: params.prompt,
      dependencies: [],
      status: 'pending',
      priority: params.priority || 'medium',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        ...params.context,
        useCollaboration: params.useCollaboration || false,
        collaborationStrategy: params.collaborationStrategy || { type: 'sequential', config: {} }
      }
    };

    this.tasks.set(task.id, task);
    this.taskQueue.push(task);
    this.sortTaskQueue();
    
    this.logger.info(`✨ Task created: ${task.id} - ${task.title}`);
    this.emit('task:created', task);
    
    return task;
  }

  public async executeTask(taskId: string, forceCollaboration?: boolean): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const useCollaboration = forceCollaboration || 
                            task.metadata?.useCollaboration || 
                            this.shouldUseCollaboration(task);

    if (useCollaboration) {
      return this.executeWithCollaboration(task);
    } else {
      return this.executeSingleAgent(task);
    }
  }

  private async executeSingleAgent(task: Task): Promise<any> {
    const agentScores = this.agentRegistry.findBestAgentForTask(task);
    if (agentScores.length === 0) {
      throw new Error('No suitable agent found for this task');
    }

    const bestAgentId = agentScores[0].agentId;
    const bestAgent = this.agentRegistry.getAgent(bestAgentId);
    
    if (!bestAgent) {
      throw new Error('Agent not found');
    }

    task.assignedAgent = bestAgent.config.id;
    task.status = 'assigned';
    task.startedAt = new Date();
    
    this.runningTasks.set(task.id, {
      agentId: bestAgent.config.id,
      startTime: new Date()
    });

    this.logger.info(`🎯 Task ${task.id} assigned to ${bestAgent.config.name}`);
    this.emit('task:assigned', { task, agent: bestAgent.config });

    try {
      task.status = 'in_progress';
      
      const request: AgentRequest = {
        taskId: task.id,
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
        
        this.logger.info(`✅ Task ${task.id} completed in ${response.duration}ms`);
        this.emit('task:completed', { task, response });
      } else {
        task.status = 'failed';
        task.error = response.error;
        
        this.logger.error(`❌ Task ${task.id} failed: ${response.error}`);
        this.emit('task:failed', { task, error: response.error });
      }

      return response;
      
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error(`💥 Task ${task.id} execution error:`, error);
      this.emit('task:error', { task, error });
      
      return {
        taskId: task.id,
        agentId: bestAgent.config.id,
        success: false,
        status: 'failed',
        error: task.error,
        duration: Date.now() - (task.startedAt?.getTime() || Date.now())
      };
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  private async executeWithCollaboration(task: Task): Promise<any> {
    this.logger.info(`🤝 Starting collaboration for task ${task.id}`);
    
    task.status = 'in_progress';
    task.startedAt = new Date();

    try {
      // Get collaboration strategy from task metadata
      const strategy: CollaborationStrategy = task.metadata?.collaborationStrategy || 
        this.determineCollaborationStrategy(task);

      this.logger.info(`📋 Using ${strategy.type} collaboration strategy`);

      // Create collaboration session using CollaborationManager
      const session = await this.collaborationManager.createCollaborationSession(task, strategy);
      
      task.metadata = {
        ...task.metadata,
        collaborationSessionId: session.id,
        collaborationAgents: session.agents,
        collaborationStrategy: strategy.type
      };

      this.emit('collaboration:started', { 
        task, 
        sessionId: session.id,
        strategy: strategy.type,
        agents: session.agents 
      });

      // Execute collaboration session
      const results = await this.collaborationManager.executeCollaborationSession(session.id);
      
      // Task completion handled by collaboration event handlers
      return {
        taskId: task.id,
        success: true,
        collaborationSession: session.id,
        results: results,
        duration: task.actualDuration || 0
      };

    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Collaboration failed';
      
      this.logger.error(`💥 Collaboration failed for task ${task.id}:`, error);
      this.emit('task:error', { task, error });
      
      throw error;
    }
  }


  private shouldUseCollaboration(task: Task): boolean {
    // Auto-detect if task needs collaboration
    const complexityKeywords = [
      'review', 'validate', 'compare', 'multiple perspectives',
      'complex', 'full stack', 'comprehensive', 'end-to-end',
      'integrate', 'coordinate', 'collaborate'
    ];
    
    const description = task.description.toLowerCase();
    const hasComplexityIndicator = complexityKeywords.some(keyword => 
      description.includes(keyword)
    );

    // High priority tasks might benefit from collaboration
    const isHighPriority = task.priority === 'critical' || task.priority === 'high';
    
    return hasComplexityIndicator || (isHighPriority && description.length > 200);
  }

  private determineCollaborationStrategy(task: Task): CollaborationStrategy {
    const description = task.description.toLowerCase();

    // Sequential: step-by-step tasks
    if (description.includes('step by step') || description.includes('phase')) {
      return { type: 'sequential', config: {} };
    }

    // Parallel: independent components
    if (description.includes('parallel') || description.includes('independent')) {
      return { type: 'parallel', config: {} };
    }

    // Hierarchical: complex projects with planning
    if (description.includes('project') || description.includes('plan')) {
      return { type: 'hierarchical', config: {} };
    }

    // Consensus: needs validation or multiple opinions
    if (description.includes('review') || description.includes('validate') || 
        description.includes('consensus')) {
      return { type: 'consensus', config: {} };
    }

    // Default to sequential
    return { type: 'sequential', config: {} };
  }

  public getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
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

  public getRunningTasks(): Map<string, { agentId: string, startTime: Date }> {
    return new Map(this.runningTasks);
  }

  public updateTask(taskId: string, updates: Partial<Task>): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }
    
    const updatedTask = {
      ...task,
      ...updates,
      id: task.id,
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
    this.taskQueue = this.taskQueue.filter(t => t.id !== taskId);
    this.emit('task:deleted', { taskId });
    
    return true;
  }

  private sortTaskQueue(): void {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    this.taskQueue.sort((a, b) => {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private generateTaskTitle(prompt: string): string {
    const firstLine = prompt.split('\n')[0];
    const title = firstLine.substring(0, 100);
    return title.length < firstLine.length ? title + '...' : title;
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

  public getCollaborationSession(sessionId: string) {
    return this.collaborationManager.getSession(sessionId);
  }

  public getAllCollaborationSessions() {
    return this.collaborationManager.getAllSessions();
  }
}