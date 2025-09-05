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

  async initialize(): Promise<void> {
    try {
      await this.loadConfigurations();
      this.logger.info('OAuth2/OIDC service initialized successfully', {
        providers: this.configs.size
      });
    } catch (error) {
      this.logger.error('Failed to initialize OAuth2/OIDC service:', error);
      throw error;
    }
  }

  private async loadConfigurations(): Promise<void> {
    await this.createDefaultConfigurations();
  }

  private async createDefaultConfigurations(): Promise<void> {
    const defaultConfigs: (OAuth2Config | OIDCConfig)[] = [
      {
        id: 'google-oauth2',
        organizationId: 'default',
        name: 'Google OAuth2',
        provider: 'google',
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        scopes: ['openid', 'email', 'profile'],
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/oauth2/callback/google',
        enabled: !!process.env.GOOGLE_CLIENT_ID,
        issuer: 'https://accounts.google.com',
        discoveryUrl: 'https://accounts.google.com/.well-known/openid_configuration',
        useDiscovery: true,
        jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs'
      } as OIDCConfig,
      {
        id: 'microsoft-oauth2',
        organizationId: 'default',
        name: 'Microsoft Azure AD',
        provider: 'microsoft',
        clientId: process.env.AZURE_CLIENT_ID || '',
        clientSecret: process.env.AZURE_CLIENT_SECRET || '',
        authorizationUrl: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}/oauth2/v2.0/token`,
        userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
        scopes: ['openid', 'email', 'profile', 'User.Read'],
        redirectUri: process.env.AZURE_REDIRECT_URI || 'http://localhost:3000/auth/oauth2/callback/microsoft',
        enabled: !!process.env.AZURE_CLIENT_ID,
        issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}/v2.0`,
        useDiscovery: true,
        jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys'
      } as OIDCConfig
    ];

    for (const config of defaultConfigs) {
      if (config.enabled) {
        await this.configureProvider(config);
      }
    }
  }

  async configureProvider(config: OAuth2Config | OIDCConfig): Promise<void> {
    try {
      // Validate configuration
      this.validateConfig(config);

      // Setup HTTP client
      const httpClient = axios.create({
        timeout: 30000,
        headers: {
          'User-Agent': 'MultiAgentOrchestrator/1.0'
        }
      });

      this.httpClients.set(config.id, httpClient);

      // Setup JWKS client for OIDC
      if (this.isOIDCConfig(config) && config.jwksUrl) {
        const jwksClientInstance = jwksClient({
          jwksUri: config.jwksUrl,
          cache: true,
          cacheMaxEntries: 5,
          cacheMaxAge: 600000, // 10 minutes
          rateLimit: true,
          jwksRequestsPerMinute: 10
        });

        this.jwksClients.set(config.id, jwksClientInstance);
      }

      // Load discovery document for OIDC
      if (this.isOIDCConfig(config) && config.useDiscovery) {
        await this.loadDiscoveryDocument(config);
      }

      this.configs.set(config.id, config);

      this.logger.info('OAuth2/OIDC provider configured', {
        id: config.id,
        provider: config.provider,
        organizationId: config.organizationId
      });

    } catch (error) {
      this.logger.error('Failed to configure OAuth2/OIDC provider:', error);
      throw error;
    }
  }

    private validateConfig(config: OAuth2Config | OIDCConfig): void {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Client ID and Client Secret are required');
    }

    if (!config.authorizationUrl || !config.tokenUrl) {
      throw new Error('Authorization URL and Token URL are required');
    }

    if (!config.redirectUri) {
      throw new Error('Redirect URI is required');
    }

    if (!config.scopes || config.scopes.length === 0) {
      throw new Error('At least one scope is required');
    }
  }

  private isOIDCConfig(config: OAuth2Config | OIDCConfig): config is OIDCConfig {
    return 'issuer' in config;
  }

  private async loadDiscoveryDocument(config: OIDCConfig): Promise<void> {
    if (!config.discoveryUrl) return;

    try {
      const httpClient = this.httpClients.get(config.id);
      if (!httpClient) throw new Error('HTTP client not configured');

      const response = await httpClient.get(config.discoveryUrl);
      const discovery = response.data;

      // Update configuration with discovered endpoints
      if (discovery.authorization_endpoint) {
        config.authorizationUrl = discovery.authorization_endpoint;
      }
      if (discovery.token_endpoint) {
        config.tokenUrl = discovery.token_endpoint;
      }
      if (discovery.userinfo_endpoint) {
        config.userInfoUrl = discovery.userinfo_endpoint;
      }
      if (discovery.jwks_uri) {
        config.jwksUrl = discovery.jwks_uri;
      }
      if (discovery.end_session_endpoint) {
        config.endSessionEndpoint = discovery.end_session_endpoint;
      }

      this.discoveryCache.set(config.id, discovery);

      this.logger.info('OIDC discovery document loaded', {
        providerId: config.id,
        issuer: config.issuer
      });

    } catch (error) {
      this.logger.warn('Failed to load OIDC discovery document:', error);
    }
  }


};