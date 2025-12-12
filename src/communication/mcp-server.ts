import { EventEmitter } from 'events';
import express, { Express, Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { createServer, Server as HTTPServer } from 'http';
import { MCPServer, MCPTool, Message } from '../interfaces/communication.interface';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';


export class MCPServerImplementation implements MCPServer {
  public id: string;
  public name: string;
  public tools: Map<string, MCPTool>;
  
  private app: Express;
  private httpServer: HTTPServer;
  private io: SocketIOServer;
  private eventEmitter: EventEmitter;
  private logger: winston.Logger;
  private port: number;
  private secretKey: string;

  constructor(
    name: string,
    port: number = 4000,
    secretKey: string = process.env.MCP_SECRET_KEY || 'default-secret'
  ) {
    this.id = uuidv4();
    this.name = name;
    this.tools = new Map();
    this.port = port;
    this.secretKey = secretKey;
    this.eventEmitter = new EventEmitter();
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
  }
}