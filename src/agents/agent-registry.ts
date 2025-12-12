import { AgentConfig, AgentCapability, BaseAgent } from '../interfaces/agent.interface';
import { Task } from '../interfaces/task.interface';
import winston from 'winston';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import path from 'path';

interface AgentScore {
  agentId: string;
  score: number;
  reasons: string[];
}

export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private agentConfigs: Map<string, AgentConfig> = new Map();
  private logger: winston.Logger;
  private capabilityIndex: Map<string, Set<string>> = new Map();

  constructor() {
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