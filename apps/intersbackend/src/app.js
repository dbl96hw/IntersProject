import express from 'express';
import { config as defaultConfig } from './config/env.js';
import { ANALYSIS_MODES, JSON_BODY_LIMIT } from './constants/index.js';
import { db as defaultDb } from './db/index.js';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { createUpload } from './middleware/upload.js';
import { createCandidatesRouter } from './routes/candidates.routes.js';
import { createChatsRouter } from './routes/chats.routes.js';
import { createEngineRouter } from './routes/engine.routes.js';
import { createHealthRouter } from './routes/health.js';
import { createRootRouter } from './routes/root.js';
import { createClaudeClient } from './llm/claude.client.js';
import { createAnalysisService } from './services/analysis.service.js';
import { createCandidatesService } from './services/candidates.service.js';
import { createChatsService } from './services/chats.service.js';
import { createDataEngineClient } from './services/dataEngineClient.js';
import { createIngestService } from './services/ingest.service.js';
import { createEngineService } from './services/engine.service.js';
import { createMemoryFileStorage, createSupabaseFileStorage } from './services/fileStorage.js';

function createDefaultFileStorage(config) {
  return config.analysisMode === ANALYSIS_MODES.LIVE
    ? createSupabaseFileStorage(config.supabaseBucket)
    : createMemoryFileStorage();
}

export function createApp({
  config = defaultConfig, dataEngineClient, claude, db = defaultDb, fileStorage,
} = {}) {
  const engineClient = dataEngineClient ?? createDataEngineClient({
    baseUrl: config.dataEngineUrl,
    timeoutMs: config.dataEngineTimeoutMs,
    ingestTimeoutMs: config.dataEngineIngestTimeoutMs,
  });
  const claudeClient = claude !== undefined
    ? claude
    : (config.analysisMode === ANALYSIS_MODES.LIVE ? createClaudeClient({
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
      batchSize: config.batchSize,
      maxParallelBatches: config.maxParallelBatches,
    }) : null);

  const analysisService = createAnalysisService({
    config,
    ingest: createIngestService({ dataEngine: engineClient }),
    claude: claudeClient,
    dataEngine: engineClient,
    db,
  });
  const chatsService = createChatsService({
    db,
    fileStorage: fileStorage ?? createDefaultFileStorage(config),
    analysisService,
  });
  const candidatesService = createCandidatesService({ config, db, dataEngineClient: engineClient });
  const engineService = createEngineService({ config, dataEngineClient: engineClient });
  const upload = createUpload({ maxFileMb: config.maxFileMb, maxFiles: config.maxFiles });

  const app = express();

  app.use(cors(config.corsOrigin));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use(createRootRouter());
  app.use(createHealthRouter({ config, dataEngineClient: engineClient }));
  app.use(createChatsRouter({ chatsService, upload }));
  app.use(createCandidatesRouter({ candidatesService }));
  app.use(createEngineRouter({ engineService }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
