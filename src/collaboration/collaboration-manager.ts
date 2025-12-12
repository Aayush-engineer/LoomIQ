import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentRequest } from '../interfaces/agent.interface';
import { Task } from '../interfaces/task.interface';
import { AgentRegistry } from '../agents/agent-registry';
import { CommunicationHubImplementation } from '../communication/communication-hub';
import winston from 'winston';


export interface CollaborationSession {
  id: string;
  taskId: string;
  agents: string[];
  strategy: CollaborationStrategy['type'];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  results: CollaborationResult[];
  createdAt: Date;
  completedAt?: Date;
}

export interface CollaborationResult {
  agentId: string;
  agentName: string;
  output: any;
  duration: number;
  timestamp: Date;
}

export interface CollaborationStrategy {
  type: 'sequential' | 'parallel' | 'consensus';
  config?: Record<string, any>;
}


export class CollaborationManager extends EventEmitter {
  private sessions: Map<string, CollaborationSession> = new Map();
  private logger: winston.Logger;

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
    this.setupCommunicationHandlers();
  }
private setupCommunicationHandlers(): void {
    // Listen for agent collaboration requests
    this.communicationHub.on('collaboration:request', (data) => {
      this.handleCollaborationRequest(data);
    });

    // Listen for collaboration updates
    this.communicationHub.on('collaboration:update', (data) => {
      this.handleCollaborationUpdate(data);
    });
  }

  // ============================================
  // CORE COLLABORATION METHODS
  // ============================================

  public async createCollaborationSession(
    task: Task,
    strategy: CollaborationStrategy = { type: 'sequential' }
  ): Promise<CollaborationSession> {
    
    // Select best agents for this task
    const selectedAgents = await this.selectAgentsForTask(task, strategy);
    
    if (selectedAgents.length < 2) {
      throw new Error('Need at least 2 agents for collaboration');
    }

    const session: CollaborationSession = {
      id: uuidv4(),
      taskId: task.id,
      agents: selectedAgents.map(a => a.id),
      strategy: strategy.type,
      status: 'planning',
      results: [],
      createdAt: new Date()
    };

    this.sessions.set(session.id, session);
    this.logger.info(`🤝 Created ${strategy.type} collaboration session ${session.id}`);
    this.emit('session:created', session);

    return session;
  }

  public async executeCollaborationSession(sessionId: string): Promise<CollaborationResult[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Collaboration session not found');
    }

    session.status = 'executing';
    this.emit('session:started', session);

    try {
      let results: CollaborationResult[];

      // Execute based on strategy
      switch (session.strategy) {
        case 'sequential':
          results = await this.executeSequential(session);
          break;
        case 'parallel':
          results = await this.executeParallel(session);
          break;
        case 'consensus':
          results = await this.executeConsensus(session);
          break;
        default:
          throw new Error(`Unknown strategy: ${session.strategy}`);
      }

      session.status = 'completed';
      session.results = results;
      session.completedAt = new Date();
      
      this.logger.info(`✅ Collaboration session ${sessionId} completed`);
      this.emit('session:completed', session);
      
      return results;

    } catch (error) {
      session.status = 'failed';
      this.logger.error(`❌ Collaboration session ${sessionId} failed:`, error);
      this.emit('session:failed', { session, error });
      throw error;
    }
  }

  
  // COLLABORATION STRATEGIES
  
  private async executeSequential(session: CollaborationSession): Promise<CollaborationResult[]> {
    this.logger.info(`🔄 Executing sequential collaboration`);
    
    const task = await this.getTask(session.taskId);
    const results: CollaborationResult[] = [];
    let previousResult: any = null;

    for (let i = 0; i < session.agents.length; i++) {
      const agentId = session.agents[i];
      const agent = this.agentRegistry.getAgent(agentId);
      
      if (!agent) {
        this.logger.warn(`Agent ${agentId} not found, skipping`);
        continue;
      }

      const role = i === 0 ? 'initiator' : 'reviewer';
      const prompt = this.buildSequentialPrompt(task, role, previousResult);

      this.logger.info(`👤 Agent ${agent.config.name} working (${role})...`);
      this.emit('step:started', { 
        session, 
        step: { name: `${role} - ${agent.config.name}`, assignedAgent: agentId } 
      });

      const startTime = Date.now();
      
      const request: AgentRequest = {
        taskId: session.taskId,
        prompt: prompt,
        context: {
          collaborationSession: session.id,
          role: role,
          previousResult: previousResult
        },
        priority: 'high'
      };

      const response = await agent.execute(request);
      
      if (response.success) {
        const result: CollaborationResult = {
          agentId: agent.id,
          agentName: agent.config.name,
          output: response.result,
          duration: Date.now() - startTime,
          timestamp: new Date()
        };

        results.push(result);
        previousResult = response.result;

        this.logger.info(`✅ Agent ${agent.config.name} completed`);
        this.emit('step:completed', { session, step: { name: role }, result });
      } else {
        this.logger.error(`Agent ${agent.config.name} failed: ${response.error}`);
      }
    }

    return results;
  }

  private async executeParallel(session: CollaborationSession): Promise<CollaborationResult[]> {
    this.logger.info(`⚡ Executing parallel collaboration`);
    
    const task = await this.getTask(session.taskId);
    const results: CollaborationResult[] = [];

    // All agents work simultaneously on the same task
    const agentPromises = session.agents.map(async (agentId) => {
      const agent = this.agentRegistry.getAgent(agentId);
      if (!agent) return null;

      this.logger.info(`👤 Agent ${agent.config.name} working in parallel...`);
      this.emit('step:started', { 
        session, 
        step: { name: `Parallel - ${agent.config.name}`, assignedAgent: agentId } 
      });

      const startTime = Date.now();

      const request: AgentRequest = {
        taskId: session.taskId,
        prompt: `${task.description}\n\nProvide your independent solution to this task.`,
        context: {
          collaborationSession: session.id,
          mode: 'parallel'
        },
        priority: 'high'
      };

      const response = await agent.execute(request);

      if (response.success) {
        return {
          agentId: agent.id,
          agentName: agent.config.name,
          output: response.result,
          duration: Date.now() - startTime,
          timestamp: new Date()
        };
      }
      return null;
    });

    const parallelResults = await Promise.all(agentPromises);
    
    // Filter out nulls and add to results
    for (const result of parallelResults) {
      if (result) {
        results.push(result);
        this.emit('step:completed', { session, step: { name: 'parallel' }, result });
      }
    }

    return results;
  }

  private async executeConsensus(session: CollaborationSession): Promise<CollaborationResult[]> {
    this.logger.info(`🗳️ Executing consensus collaboration`);
    
    const task = await this.getTask(session.taskId);
    const results: CollaborationResult[] = [];

    // Phase 1: All agents provide their analysis
    const analyses: CollaborationResult[] = [];
    
    for (const agentId of session.agents) {
      const agent = this.agentRegistry.getAgent(agentId);
      if (!agent) continue;

      this.logger.info(`👤 Agent ${agent.config.name} analyzing...`);
      
      const startTime = Date.now();
      const request: AgentRequest = {
        taskId: session.taskId,
        prompt: `${task.description}\n\nProvide your analysis and proposed approach.`,
        context: { mode: 'analysis' },
        priority: 'high'
      };

      const response = await agent.execute(request);
      
      if (response.success) {
        analyses.push({
          agentId: agent.id,
          agentName: agent.config.name,
          output: response.result,
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }
    }

    results.push(...analyses);

    // Phase 2: Lead agent builds consensus
    const leadAgent = this.agentRegistry.getAgent(session.agents[0]);
    if (leadAgent) {
      this.logger.info(`🤔 Building consensus...`);
      
      const consensusPrompt = this.buildConsensusPrompt(task, analyses);
      const startTime = Date.now();

      const request: AgentRequest = {
        taskId: session.taskId,
        prompt: consensusPrompt,
        context: { mode: 'consensus', analyses },
        priority: 'high'
      };

      const response = await leadAgent.execute(request);
      
      if (response.success) {
        results.push({
          agentId: leadAgent.id,
          agentName: `${leadAgent.config.name} (Consensus)`,
          output: response.result,
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }
    }

    return results;
  }

  private async selectAgentsForTask(
    task: Task, 
    strategy: CollaborationStrategy
  ): Promise<Agent[]> {
    // Get agents best suited for this task
    const agentScores = this.agentRegistry.findBestAgentForTask(task);
    
    // Select top 2-3 agents based on strategy
    const numAgents = strategy.type === 'consensus' ? 3 : 2;
    const selectedIds = agentScores.slice(0, numAgents).map(s => s.agentId);
    
    const agents = selectedIds
      .map(id => this.agentRegistry.getAgent(id))
      .filter(agent => agent !== undefined) as Agent[];

    return agents;
  }

  private buildSequentialPrompt(task: Task, role: string, previousResult: any): string {
    if (role === 'initiator') {
      return `${task.description}\n\nYou are the first agent. Provide your initial solution.`;
    } else {
      return `${task.description}

Previous agent's work:
${JSON.stringify(previousResult, null, 2)}

Review and improve the previous work. Provide:
1. What works well
2. What could be improved
3. Your improved version`;
    }
  }

  private buildConsensusPrompt(task: Task, analyses: CollaborationResult[]): string {
    const analysesText = analyses.map((a, i) => 
      `Agent ${i + 1} (${a.agentName}):
${JSON.stringify(a.output, null, 2)}
`
    ).join('\n\n');

    return `${task.description}

Multiple agents have analyzed this task. Here are their perspectives:

${analysesText}

Build a consensus solution that:
1. Incorporates the best ideas from each analysis
2. Addresses any conflicts between approaches
3. Provides a unified, coherent solution`;
  }

  private async getTask(taskId: string): Promise<Task> {
    // In real implementation, fetch from task orchestrator
    // For now, return a minimal task object
    return {
      id: taskId,
      description: 'Task description',
      type: 'implementation',
      status: 'in_progress'
    } as Task;
  }


  public getSession(sessionId: string): CollaborationSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions(): CollaborationSession[] {
    return Array.from(this.sessions.values());
  }

  public getSessionStats() {
    const sessions = Array.from(this.sessions.values());
    return {
      total: sessions.length,
      completed: sessions.filter(s => s.status === 'completed').length,
      failed: sessions.filter(s => s.status === 'failed').length,
      active: sessions.filter(s => s.status === 'executing').length,
      byStrategy: {
        sequential: sessions.filter(s => s.strategy === 'sequential').length,
        parallel: sessions.filter(s => s.strategy === 'parallel').length,
        consensus: sessions.filter(s => s.strategy === 'consensus').length
      }
    };
  }

  private handleCollaborationRequest(data: any): void {
    // Handle incoming collaboration requests from agents
    this.logger.info('Received collaboration request:', data);
  }

  private handleCollaborationUpdate(data: any): void {
    // Handle collaboration updates from agents
    this.logger.info('Received collaboration update:', data);
  }
}