import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import winston from 'winston';
import { DatabaseService } from './database/database-service';

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






