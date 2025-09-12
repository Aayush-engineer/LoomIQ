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


router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, organizationId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Mock local authentication - replace with actual implementation
    const user = {
      id: 'user-123',
      email,
      name: 'Test User',
      organizationId: organizationId || 'default',
      roles: ['org_member'],
      permissions: ['task:read', 'task:write'],
      authMethod: 'local' as const
    };

    // Generate JWT token
    const token = authMiddleware.generateToken(user);

    logger.info('Local authentication successful', {
      email,
      organizationId: user.organizationId
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        organizationId: user.organizationId,
        roles: user.roles,
        authMethod: user.authMethod
      },
      token,
      expiresIn: '24h'
    });

  } catch (error) {
    logger.error('Local authentication failed:', error);
    res.status(401).json({
      error: 'Authentication failed',
      message: 'Invalid credentials'
    });
  }
});

/**
 * Logout endpoint
 */
router.post('/logout', authMiddleware.authenticate({ required: false }), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.cookies?.sessionId;
    
    if (sessionId) {
      await authMiddleware.destroySession(sessionId);
      res.clearCookie('sessionId');
    }

    if (req.user) {
      logger.info('User logged out', {
        userId: req.user.id,
        authMethod: req.user.authMethod
      });
    }

    res.json({ success: true });

  } catch (error) {
    logger.error('Logout failed:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * Get current user info
 */
router.get('/me', authMiddleware.authenticate({ required: true }), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        organizationId: req.user.organizationId,
        roles: req.user.roles,
        authMethod: req.user.authMethod
      }
    });

  } catch (error) {
    logger.error('Failed to get user info:', error);
    res.status(500).json({ error: 'Failed to retrieve user information' });
  }
});

// SAML Authentication Routes

/**
 * SAML Login - Initiate authentication
 */
router.get('/saml/:idpId/login', async (req: Request, res: Response) => {
  const { idpId } = req.params;
  const relayState = req.query.RelayState as string;
  
  if (!samlService) {
    return res.status(500).json({ error: 'SAML not configured' });
  }

  try {
    const organizationId = req.query.organizationId as string || 'default';
    
    const authRequest = await samlService.generateAuthRequest(
      organizationId,
      idpId,
      relayState
    );

    logger.info('SAML authentication initiated', {
      idpId,
      organizationId,
      requestId: authRequest.id
    });

    res.redirect(authRequest.url);

  } catch (error) {
    logger.error('SAML authentication initiation failed:', error);
    res.status(500).json({ 
      error: 'Failed to initiate SAML authentication' 
    });
  }
});

/**
 * SAML Callback - Process authentication response
 */
router.post('/saml/:idpId/acs', async (req: Request, res: Response) => {
  const { idpId } = req.params;
  
  if (!samlService) {
    return res.status(500).json({ error: 'SAML not configured' });
  }

  try {
    const organizationId = req.query.organizationId as string || 'default';
    const samlResponse = req.body.SAMLResponse;
    const relayState = req.body.RelayState;

    const authResult = await samlService.processAuthResponse(
      organizationId,
      idpId,
      samlResponse,
      relayState
    );

    if (!authResult.success || !authResult.user) {
      logger.warn('SAML authentication failed', {
        idpId,
        organizationId,
        error: authResult.error
      });

      return res.status(401).json({
        error: 'SAML authentication failed',
        message: authResult.error
      });
    }

    // Create authenticated user object
    const user = {
      id: authResult.user.nameId,
      email: authResult.user.email,
      name: authResult.user.firstName && authResult.user.lastName 
        ? `${authResult.user.firstName} ${authResult.user.lastName}`
        : undefined,
      organizationId,
      roles: ['org_member'], // Would be populated from SAML attributes
      permissions: ['task:read', 'task:write'], // Would be populated from roles
      authMethod: 'saml' as const
    };

    // Create session
    const session = await authMiddleware.createSession(user, req);

    // Set session cookie
    res.cookie('sessionId', session.sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    });

    logger.info('SAML authentication successful', {
      idpId,
      organizationId,
      userId: user.id,
      email: user.email
    });

    // Redirect to relay state or default
    const redirectUrl = relayState || '/dashboard';
    res.redirect(redirectUrl);

  } catch (error) {
    logger.error('SAML callback processing failed:', error);
    res.status(500).json({ 
      error: 'Failed to process SAML authentication' 
    });
  }
});

/**
 * SAML Logout
 */
router.get('/saml/:idpId/logout', authMiddleware.authenticate({ required: false }), async (req: Request, res: Response) => {
  const { idpId } = req.params;
  
  if (!samlService) {
    return res.status(500).json({ error: 'SAML not configured' });
  }

  try {
    const organizationId = req.query.organizationId as string || 'default';
    const nameId = (req as AuthenticatedRequest).user?.id || req.query.nameId as string;
    const sessionId = req.cookies?.sessionId;

    if (nameId) {
      const logoutRequest = await samlService.generateLogoutRequest(
        organizationId,
        idpId,
        nameId,
        sessionId
      );

      logger.info('SAML logout initiated', {
        idpId,
        organizationId,
        nameId
      });

      res.redirect(logoutRequest.url);
    } else {
      // Local logout only
      if (sessionId) {
        await authMiddleware.destroySession(sessionId);
        res.clearCookie('sessionId');
      }
      res.redirect('/login');
    }

  } catch (error) {
    logger.error('SAML logout failed:', error);
    res.status(500).json({ 
      error: 'Failed to initiate SAML logout' 
    });
  }
});

/**
 * SAML Single Logout Service
 */
router.post('/saml/:idpId/sls', async (req: Request, res: Response) => {
  const { idpId } = req.params;
  
  if (!samlService) {
    return res.status(500).json({ error: 'SAML not configured' });
  }

  try {
    const organizationId = req.query.organizationId as string || 'default';
    const samlResponse = req.body.SAMLResponse;

    const logoutResult = await samlService.processLogoutResponse(
      organizationId,
      idpId,
      samlResponse
    );

    if (logoutResult.success) {
      logger.info('SAML logout successful', {
        idpId,
        organizationId
      });
    } else {
      logger.warn('SAML logout failed', {
        idpId,
        organizationId,
        error: logoutResult.error
      });
    }

    res.redirect('/login');

  } catch (error) {
    logger.error('SAML logout processing failed:', error);
    res.redirect('/login');
  }
});
