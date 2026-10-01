import { Router } from 'express';
import { ANALYSIS_MODES, ENGINE_STATUS, HEALTH_CHECK_TIMEOUT_MS, HEALTH_PATH } from '../constants/index.js';

async function checkEngine(analysisMode, dataEngineClient) {
  if (analysisMode !== ANALYSIS_MODES.LIVE) return ENGINE_STATUS.SKIPPED;
  try {
    await dataEngineClient.health({ timeoutMs: HEALTH_CHECK_TIMEOUT_MS });
    return ENGINE_STATUS.UP;
  } catch {
    return ENGINE_STATUS.DOWN;
  }
}

// Always 200: the backend itself is healthy even when the engine is down.
export function createHealthRouter({ config, dataEngineClient }) {
  const router = Router();

  router.get(HEALTH_PATH, async (req, res) => {
    const engine = await checkEngine(config.analysisMode, dataEngineClient);
    res.json({ healthy: true, mode: config.analysisMode, engine });
  });

  return router;
}
