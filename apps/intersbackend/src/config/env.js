import { z } from 'zod';
import {
  ANALYSIS_MODES,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CORS_ORIGIN,
  DEFAULT_DATA_ENGINE_INGEST_TIMEOUT_MS,
  DEFAULT_DATA_ENGINE_TIMEOUT_MS,
  DEFAULT_DATA_ENGINE_URL,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_MB,
  DEFAULT_MAX_PARALLEL_BATCHES,
  DEFAULT_PORT,
  DEFAULT_SUPABASE_BUCKET,
  MIN_DATA_ENGINE_INGEST_TIMEOUT_MS,
} from '../constants/index.js';

const LIVE_REQUIRED_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATA_ENGINE_URL',
];

const positiveInt = (defaultValue) => z.coerce.number().int().positive().default(defaultValue);

const envSchema = z.object({
  PORT: positiveInt(DEFAULT_PORT),
  CORS_ORIGIN: z.string().default(DEFAULT_CORS_ORIGIN),
  ANALYSIS_MODE: z.enum(Object.values(ANALYSIS_MODES)).default(ANALYSIS_MODES.MOCK),
  DATA_ENGINE_URL: z.url().optional(),
  DATA_ENGINE_TIMEOUT_MS: positiveInt(DEFAULT_DATA_ENGINE_TIMEOUT_MS),
  DATA_ENGINE_INGEST_TIMEOUT_MS: z.coerce.number().int()
    .min(MIN_DATA_ENGINE_INGEST_TIMEOUT_MS, `must be at least ${MIN_DATA_ENGINE_INGEST_TIMEOUT_MS} ms`)
    .default(DEFAULT_DATA_ENGINE_INGEST_TIMEOUT_MS),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_BUCKET: z.string().default(DEFAULT_SUPABASE_BUCKET),
  MAX_FILE_MB: positiveInt(DEFAULT_MAX_FILE_MB),
  MAX_FILES: positiveInt(DEFAULT_MAX_FILES),
  BATCH_SIZE: positiveInt(DEFAULT_BATCH_SIZE),
  MAX_PARALLEL_BATCHES: positiveInt(DEFAULT_MAX_PARALLEL_BATCHES),
});

// Blank lines like `ANTHROPIC_API_KEY=` in .env must count as missing, not as a value.
function dropEmptyValues(source) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ''));
}

// Messages name variables only; values may be secrets and are never printed.
function describeIssues(issues) {
  return issues.map((issue) => `${issue.path.join('.')} (${issue.message})`).join(', ');
}

export function parseEnv(source) {
  const result = envSchema.safeParse(dropEmptyValues(source));
  if (!result.success) {
    throw new Error(`Invalid environment: ${describeIssues(result.error.issues)}`);
  }

  const env = result.data;
  const isLive = env.ANALYSIS_MODE === ANALYSIS_MODES.LIVE;
  if (isLive) {
    const missing = LIVE_REQUIRED_VARIABLES.filter((name) => env[name] === undefined);
    if (missing.length > 0) {
      throw new Error(`Invalid environment: missing ${missing.join(', ')} (required when ANALYSIS_MODE=live)`);
    }
  }

  return Object.freeze({
    port: env.PORT,
    corsOrigin: env.CORS_ORIGIN,
    analysisMode: env.ANALYSIS_MODE,
    dataEngineUrl: env.DATA_ENGINE_URL ?? DEFAULT_DATA_ENGINE_URL,
    dataEngineTimeoutMs: env.DATA_ENGINE_TIMEOUT_MS,
    dataEngineIngestTimeoutMs: env.DATA_ENGINE_INGEST_TIMEOUT_MS,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseBucket: env.SUPABASE_BUCKET,
    maxFileMb: env.MAX_FILE_MB,
    maxFiles: env.MAX_FILES,
    batchSize: env.BATCH_SIZE,
    maxParallelBatches: env.MAX_PARALLEL_BATCHES,
  });
}

export const config = parseEnv(process.env);
