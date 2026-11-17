/**
 * Express application (exported without listen() so tests can use supertest).
 */
import express from 'express';
import helmet from 'helmet';
import { router } from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
