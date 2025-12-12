import { io, Socket } from 'socket.io-client';
import axios, { AxiosInstance } from 'axios';
import { Message, MCPTool } from '../interfaces/communication.interface';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';

export class MCPClient {
  private socket: Socket | null = null;
  private httpClient: AxiosInstance;
  private logger: winston.Logger;
  private serverUrl: string;
  private secretKey: string;
  private connected: boolean = false;
  private messageHandlers: Map<string, (message: Message) => void> = new Map();

  constructor(serverUrl: string, secretKey: string) {
    this.serverUrl = serverUrl;
    this.secretKey = secretKey;

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.httpClient = axios.create({
      baseURL: serverUrl,
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

}