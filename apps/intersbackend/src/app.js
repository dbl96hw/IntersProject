import express from 'express';
import { config as defaultConfig } from './config/env.js';
import { JSON_BODY_LIMIT } from './constants/index.js';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { createHealthRouter } from './routes/health.js';
import { createRootRouter } from './routes/root.js';
import { createDataEngineClient } from './services/dataEngineClient.js';

export function createApp({ config = defaultConfig, dataEngineClient } = {}) {
  const engineClient = dataEngineClient ?? createDataEngineClient({
    baseUrl: config.dataEngineUrl,
    timeoutMs: config.dataEngineTimeoutMs,
  });

  const app = express();

  app.use(cors(config.corsOrigin));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use(createRootRouter());
  app.use(createHealthRouter({ config, dataEngineClient: engineClient }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
