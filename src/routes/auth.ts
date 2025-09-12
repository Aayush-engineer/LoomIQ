import { Router, Request, Response } from 'express';
import { SAMLService } from '../services/saml-service';
import { OAuth2Service } from '../services/oauth-service';
import { SSOAuthMiddleware } from '../middleware/sso-auth-middleware';
import { DatabaseService } from '../database/database-service';
import winston from 'winston';

const router = Router();

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    organizationId: string;
    roles: string[];
    authMethod: string;
  };
}

const logger = winston.createLogger({
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
      filename: 'logs/auth-routes.log',
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

// Store services (would be injected in real application)
let samlService: SAMLService;
let oauthService: OAuth2Service;
let authMiddleware: SSOAuthMiddleware;

/**
 * Initialize auth routes with services
 */
export function initializeAuthRoutes(
  saml: SAMLService,
  oauth: OAuth2Service,
  middleware: SSOAuthMiddleware
) {
  samlService = saml;
  oauthService = oauth;
  authMiddleware = middleware;
}


router.get('/methods/:organizationId?', async (req: Request, res: Response) => {
  try {
    const organizationId = req.params.organizationId || 'default';
    
    const methods: any[] = [
      {
        id: 'local',
        name: 'Email/Password',
        type: 'local',
        enabled: true,
        loginUrl: '/auth/login'
      }
    ];

    // Get SAML providers
    if (samlService) {
      const samlProviders = await samlService.listIdentityProviders(organizationId);
      methods.push(...samlProviders.map(provider => ({
        id: provider.id,
        name: provider.name,
        type: 'saml',
        enabled: provider.enabled,
        loginUrl: `/auth/saml/${provider.id}/login`
      })));
    }

    // Get OAuth2 providers
    if (oauthService) {
      const oauthProviders = await oauthService.listProviders(organizationId);
      methods.push(...oauthProviders.map(provider => ({
        id: provider.id,
        name: provider.name,
        type: provider.provider === 'custom' ? 'oauth2' : 'oidc',
        provider: provider.provider,
        enabled: provider.enabled,
        loginUrl: `/auth/oauth2/${provider.id}/login`
      })));
    }

    res.json({
      organizationId,
      methods: methods.filter(method => method.enabled)
    });

  } catch (error) {
    logger.error('Failed to get auth methods:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve authentication methods' 
    });
  }
});
