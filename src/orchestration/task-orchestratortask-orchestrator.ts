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
}