import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import winston from 'winston';
import { DatabaseService } from './database/database-service';
import { AuthService } from './services/auth-service';
import { createAuthMiddleware } from './middleware/auth-middleware';
import { createAuthRoutes } from './routes/auth-routes';
import { SAMLService } from './services/saml-service';
import { OAuth2Service } from './services/oauth-service';
import { createSSOAuthMiddleware } from './middleware/sso-auth-middleware';
import { createAuthRouter } from './routes/auth';
import { createSSORouter } from './routes/sso';
dotenv.config();

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
    new winston.transports.File({ filename: 'orchestrator.log' })
  ]
});

async function main() {
  logger.info('Starting multi-agent system');

  const db = DatabaseService.getInstance();
  try {
    await db.initialize();
    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    process.exit(1);
  }


  const app = express();
  const httpServer = createServer(app);
  const port = process.env.PORT || 3000;

  app.use(express.json());

  // Enable CORS (basic)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // Initialize auth service
  const authService = new AuthService(process.env.JWT_SECRET);
  const authMiddleware = createAuthMiddleware(authService);
  const legacyAuthRoutes = createAuthRoutes(authService);

  // Initialize SSO services
  const samlService = new SAMLService();
  const oauthService = new OAuth2Service();
  const ssoAuthMiddleware = createSSOAuthMiddleware({
    jwtSecret: process.env.JWT_SECRET || 'default-secret',
    jwtExpiry: '24h',
    sessionExpiry: 24 * 60 * 60 * 1000, // 24 hours
    requireAuth: true,
    allowedMethods: ['local', 'saml', 'oauth2', 'oidc']
  }, samlService, oauthService);

  // console.log("my middleware is", ssoAuthMiddleware);
  
  // // --- 4️⃣ Initialize routes ---
  
  const ssoRouter = createSSORouter(samlService, oauthService, ssoAuthMiddleware);
  const authRouter = createAuthRouter(samlService, oauthService, ssoAuthMiddleware);

  app.use('/api/legacy-auth', legacyAuthRoutes); // No auth
  app.use('/api/auth', authRouter);              // New auth (no auth required)
  app.use('/api/sso', ssoRouter);                // SSO config

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime()
    });
  });

  

  httpServer.listen(port, () => {
    logger.info(`Orchestrator API listening on port ${port}`);
  });
  
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await db.close();
    httpServer.close();
    process.exit(0);
  });

}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});






