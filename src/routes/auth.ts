import { Router, Request, Response } from 'express';
import { SAMLService } from '../services/saml-service';
import { OAuth2Service } from '../services/oauth-service';
import { SSOAuthMiddleware } from '../middleware/sso-auth-middleware';
import winston from 'winston';

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
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({
      filename: 'logs/auth-routes.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

/**
 * Factory: build all auth routes after dependencies are ready
 */
export function createAuthRouter(
  saml: SAMLService,
  oauth: OAuth2Service,
  middleware: SSOAuthMiddleware
) {
  const router = Router();

  // ---------- GET available auth methods ----------
  router.get('/methods/:organizationId', async (req, res) => {
    try {
      const organizationId = req.params.organizationId || 'default';

      const methods: any[] = [
        {
          id: 'local',
          name: 'Email/Password',
          type: 'local',
          enabled: true,
          loginUrl: '/auth/login',
        },
      ];

      if (saml) {
        const samlProviders = await saml.listIdentityProviders(organizationId);
        methods.push(
          ...samlProviders.map((p) => ({
            id: p.id,
            name: p.name,
            type: 'saml',
            enabled: p.enabled,
            loginUrl: `/auth/saml/${p.id}/login`,
          }))
        );
      }

      if (oauth) {
        const oauthProviders = await oauth.listProviders(organizationId);
        methods.push(
          ...oauthProviders.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.provider === 'custom' ? 'oauth2' : 'oidc',
            provider: p.provider,
            enabled: p.enabled,
            loginUrl: `/auth/oauth2/${p.id}/login`,
          }))
        );
      }

      res.json({ organizationId, methods: methods.filter((m) => m.enabled) });
    } catch (err) {
      logger.error('Failed to get auth methods:', err);
      res.status(500).json({ error: 'Failed to retrieve authentication methods' });
    }
  });

  // ---------- Local login ----------
  router.post('/login', async (req, res) => {
    try {
      const { email, password, organizationId } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = {
        id: 'user-123',
        email,
        name: 'Test User',
        organizationId: organizationId || 'default',
        roles: ['org_member'],
        permissions: ['task:read', 'task:write'],
        authMethod: 'local' as const,
      };

      const token = middleware.generateToken(user);
      res.json({ success: true, user, token, expiresIn: '24h' });
    } catch (err) {
      logger.error('Local authentication failed:', err);
      res.status(401).json({ error: 'Authentication failed' });
    }
  });

  // ---------- Logout ----------
  router.post(
    '/logout',
    middleware.authenticate({ required: false }),
    async (req: AuthenticatedRequest, res) => {
      try {
        const sessionId = req.cookies?.sessionId;
        if (sessionId) {
          await middleware.destroySession(sessionId);
          res.clearCookie('sessionId');
        }
        res.json({ success: true });
      } catch (err) {
        logger.error('Logout failed:', err);
        res.status(500).json({ error: 'Logout failed' });
      }
    }
  );

  // ---------- Current user ----------
  router.get(
    '/me',
    middleware.authenticate({ required: true }),
    (req: AuthenticatedRequest, res) => {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      res.json({ user: req.user });
    }
  );

  // ---------- SAML routes ----------
  router.get('/saml/:idpId/login', async (req, res) => {
    if (!saml) return res.status(500).json({ error: 'SAML not configured' });
    try {
      const { idpId } = req.params;
      const relayState = req.query.RelayState as string;
      const orgId = (req.query.organizationId as string) || 'default';
      const authRequest = await saml.generateAuthRequest(orgId, idpId, relayState);
      res.redirect(authRequest.url);
    } catch (err) {
      logger.error('SAML login failed:', err);
      res.status(500).json({ error: 'Failed to initiate SAML authentication' });
    }
  });

  router.post('/saml/:idpId/acs', async (req, res) => {
    if (!saml) return res.status(500).json({ error: 'SAML not configured' });
    try {
      const { idpId } = req.params;
      const orgId = (req.query.organizationId as string) || 'default';
      const { SAMLResponse, RelayState } = req.body;
      const result = await saml.processAuthResponse(orgId, idpId, SAMLResponse, RelayState);

      if (!result.success || !result.user) {
        return res.status(401).json({ error: 'SAML authentication failed', message: result.error });
      }

      const user = {
        id: result.user.nameId,
        email: result.user.email,
        organizationId: orgId,
        roles: ['org_member'],
        authMethod: 'saml' as const,
      };

      const session = await middleware.createSession(user, req);
      res.cookie('sessionId', session.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
      });

      res.redirect(RelayState || '/dashboard');
    } catch (err) {
      logger.error('SAML callback failed:', err);
      res.status(500).json({ error: 'Failed to process SAML authentication' });
    }
  });

  // ---------- OAuth2 routes ----------
  router.get('/oauth2/:providerId/login', async (req, res) => {
    if (!oauth) return res.status(500).json({ error: 'OAuth2 not configured' });
    try {
      const { providerId } = req.params;
      const state = req.query.state as string;
      const authReq = await oauth.generateAuthorizationUrl(providerId, state);
      (req.session as any) = {
        ...req.session,
        oauth2State: authReq.state,
        oauth2CodeVerifier: authReq.codeVerifier,
        oauth2Nonce: authReq.nonce,
      };
      res.redirect(authReq.url);
    } catch (err) {
      logger.error('OAuth2 login failed:', err);
      res.status(500).json({ error: 'Failed to initiate OAuth2 authentication' });
    }
  });

  router.get('/oauth2/:providerId/callback', async (req, res) => {
    if (!oauth) return res.status(500).json({ error: 'OAuth2 not configured' });
    try {
      const { providerId } = req.params;
      const { code, state, error } = req.query as any;
      if (error) return res.status(401).json({ error: 'OAuth2 authentication failed', message: error });
      if (!code) return res.status(400).json({ error: 'Authorization code missing' });

      const codeVerifier = (req.session as any)?.oauth2CodeVerifier;
      const result = await oauth.exchangeCodeForTokens(providerId, code, state, codeVerifier);
      if (!result.success || !result.user) {
        return res.status(401).json({ error: 'OAuth2 authentication failed', message: result.error });
      }

      const orgId = (req.query.organizationId as string) || 'default';
      const user = {
        id: result.user.id,
        email: result.user.email,
        organizationId: orgId,
        roles: ['org_member'],
        authMethod: 'oauth2' as const,
      };

      const session = await middleware.createSession(user, req);
      res.cookie('sessionId', session.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
      });

      res.redirect(result.state || '/dashboard');
    } catch (err) {
      logger.error('OAuth2 callback failed:', err);
      res.status(500).json({ error: 'Failed to process OAuth2 authentication' });
    }
  });

  return router;
}
