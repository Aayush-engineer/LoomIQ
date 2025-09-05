import { EventEmitter } from 'events';
import axios, { AxiosInstance } from 'axios';
import winston from 'winston';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { DatabaseService } from '../database/database-service';

export interface OAuth2Config {
  id: string;
  organizationId: string;
  name: string;
  provider: 'google' | 'microsoft' | 'okta' | 'auth0' | 'custom';
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;
  jwksUrl?: string;
  scopes: string[];
  redirectUri: string;
  additionalParams?: Record<string, string>;
  enabled: boolean;
}

export interface OIDCConfig extends OAuth2Config {
  issuer: string;
  discoveryUrl?: string;
  useDiscovery: boolean;
  idTokenSigningAlg?: string;
  userInfoEndpoint?: string;
  endSessionEndpoint?: string;
  clockTolerance?: number;
}

export interface OAuth2AuthResult {
  success: boolean;
  user?: {
    id: string;
    email: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
    verified?: boolean;
    attributes?: Record<string, any>;
  };
  tokens?: {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresIn?: number;
    tokenType?: string;
  };
  error?: string;
  state?: string;
}

export interface TokenInfo {
  valid: boolean;
  payload?: any;
  error?: string;
  expiresAt?: Date;
}

export class OAuth2Service extends EventEmitter {
  private logger: winston.Logger;
  private db: DatabaseService;
  private configs: Map<string, OAuth2Config | OIDCConfig> = new Map();
  private httpClients: Map<string, AxiosInstance> = new Map();
  private jwksClients: Map<string, jwksClient.JwksClient> = new Map();
  private discoveryCache: Map<string, any> = new Map();

  constructor() {
    super();
    this.db = DatabaseService.getInstance();
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        }),
        new winston.transports.File({ 
          filename: 'logs/oauth-service.log',
          maxsize: 10485760,
          maxFiles: 5
        })
      ]
    });
  }
};