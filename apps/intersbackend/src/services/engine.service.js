// Trust-panel passthrough: the engine's body unchanged in live mode, sample JSON in mock mode.

import { ANALYSIS_MODES } from '../constants/index.js';
import { loadSample } from '../mocks/index.js';

export function createEngineService({ config, dataEngineClient }) {
  const isLive = config.analysisMode === ANALYSIS_MODES.LIVE;
  return {
    overrideReasons: async () => (isLive ? dataEngineClient.listOverrideReasons() : loadSample('override-reasons')),
    baseline: async () => (isLive ? dataEngineClient.baseline() : loadSample('baseline')),
    quality: async () => (isLive ? dataEngineClient.quality() : loadSample('quality')),
  };
}
