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
    
  }
}