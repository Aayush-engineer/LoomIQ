import { EventEmitter } from 'events';
import * as saml from 'samlify';
import winston from 'winston';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { DatabaseService } from '../database/database-service';

export interface SAMLConfig {
  organizationId: string;
  entityId: string;
  assertionConsumerServiceUrl: string;
  singleLogoutServiceUrl?: string;
  nameIdFormat?: string;
  signAuthnRequests?: boolean;
  wantAssertionsSigned?: boolean;
  wantResponseSigned?: boolean;
  privateCert?: string;
  publicCert?: string;
  metadata?: string;
}

export interface IdentityProviderConfig {
  id: string;
  organizationId: string;
  name: string;
  entityId: string;
  ssoUrl: string;
  sloUrl?: string;
  metadata?: string;
  publicCert: string;
  nameIdFormat?: string;
  attributeMapping?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    groups?: string;
    department?: string;
    [key: string]: string | undefined;
  };
  enabled: boolean;
  autoProvisionUsers?: boolean;
  defaultRole?: string;
  allowedDomains?: string[];
}

export interface SAMLAuthResult {
  success: boolean;
  user?: {
    nameId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    attributes?: Record<string, any>;
  };
  error?: string;
  sessionId?: string;
  relayState?: string;
}

export class SAMLService extends EventEmitter {
  private logger: winston.Logger;
  private db: DatabaseService;
  private serviceProviders: Map<string, saml.ServiceProvider> = new Map();
  private identityProviders: Map<string, saml.IdentityProvider> = new Map();
  private configs: Map<string, SAMLConfig> = new Map();
  private idpConfigs: Map<string, IdentityProviderConfig> = new Map();

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
          filename: 'logs/saml-service.log',
          maxsize: 10485760,
          maxFiles: 5
        })
      ]
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.loadConfigurations();
      this.logger.info('SAML service initialized successfully', {
        serviceProviders: this.serviceProviders.size,
        identityProviders: this.identityProviders.size
      });
    } catch (error) {
      this.logger.error('Failed to initialize SAML service:', error);
      throw error;
    }
  }

  private async loadConfigurations(): Promise<void> {
    // Load configurations from database
    // For now, create a default configuration
    await this.createDefaultConfiguration();
  }

  private async createDefaultConfiguration(): Promise<void> {
    const defaultConfig: SAMLConfig = {
      organizationId: 'default',
      entityId: process.env.SAML_ENTITY_ID || 'urn:coordinaitor',
      assertionConsumerServiceUrl: process.env.SAML_ACS_URL || 'http://localhost:3000/auth/saml/acs',
      singleLogoutServiceUrl: process.env.SAML_SLO_URL || 'http://localhost:3000/auth/saml/slo',
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      signAuthnRequests: true,
      wantAssertionsSigned: true,
      wantResponseSigned: true
    };

    await this.configureSAML('default', defaultConfig);
  }

  async configureSAML(organizationId: string, config: SAMLConfig): Promise<void> {
    try {
      // Generate or load certificates
      const { privateCert, publicCert } = await this.ensureCertificates(organizationId);

      const spConfig = {
        entityID: config.entityId,
        authnRequestsSigned: config.signAuthnRequests,
        wantAssertionsSigned: config.wantAssertionsSigned,
        wantResponseSigned: config.wantResponseSigned,
        nameIDFormat: [config.nameIdFormat || 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'],
        assertionConsumerService: [{
          Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
          Location: config.assertionConsumerServiceUrl,
          isDefault: true,
          index: 0
        }],
        singleLogoutService: config.singleLogoutServiceUrl ? [{
          Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
          Location: config.singleLogoutServiceUrl
        }] : undefined,
        signingCert: publicCert,
        privateKey: privateCert,
        encryptCert: publicCert
      };

      const serviceProvider = saml.ServiceProvider(spConfig);
      this.serviceProviders.set(organizationId, serviceProvider);
      this.configs.set(organizationId, { ...config, privateCert, publicCert });

      this.logger.info('SAML Service Provider configured', {
        organizationId,
        entityId: config.entityId
      });

    } catch (error) {
      this.logger.error('Failed to configure SAML Service Provider:', error);
      throw error;
    }
  }

  async configureIdentityProvider(config: IdentityProviderConfig): Promise<void> {
    try {
      let idpConfig: any;

      if (config.metadata) {
        // Configure from metadata
        idpConfig = {
          metadata: config.metadata
        };
      } else {
        // Configure manually
        idpConfig = {
          entityID: config.entityId,
          singleSignOnService: [{
            Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
            Location: config.ssoUrl
          }],
          singleLogoutService: config.sloUrl ? [{
            Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
            Location: config.sloUrl
          }] : undefined,
          nameIDFormat: [config.nameIdFormat || 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'],
          signingCert: config.publicCert
        };
      }

      const identityProvider = saml.IdentityProvider(idpConfig);
      this.identityProviders.set(config.id, identityProvider);
      this.idpConfigs.set(config.id, config);

      this.logger.info('SAML Identity Provider configured', {
        id: config.id,
        organizationId: config.organizationId,
        name: config.name,
        entityId: config.entityId
      });

    } catch (error) {
      this.logger.error('Failed to configure SAML Identity Provider:', error);
      throw error;
    }
  }

  async generateAuthRequest(organizationId: string, idpId: string, relayState?: string): Promise<{
    url: string;
    id: string;
    context: string;
  }> {
    const serviceProvider = this.serviceProviders.get(organizationId);
    const identityProvider = this.identityProviders.get(idpId);

    if (!serviceProvider || !identityProvider) {
      throw new Error('Service Provider or Identity Provider not configured');
    }

    try {
      const { context, entityEndpoint } = serviceProvider.createLoginRequest(
        identityProvider,
        'redirect',
        {
          relayState,
          allowCreate: true,
          isPassive: false,
          forceAuthn: false
        }
      );

      const requestId = this.extractRequestId(context);

      this.logger.info('SAML authentication request generated', {
        organizationId,
        idpId,
        requestId,
        hasRelayState: !!relayState
      });

      return {
        url: entityEndpoint,
        id: requestId,
        context
      };

    } catch (error) {
      this.logger.error('Failed to generate SAML auth request:', error);
      throw error;
    }
  }

}