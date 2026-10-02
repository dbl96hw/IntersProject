// Trust-panel passthrough. The client is the real engine in live mode and the
// in-memory sample client in mock mode; this service does not branch on mode.

export function createEngineService({ dataEngineClient }) {
  return {
    overrideReasons: () => dataEngineClient.listOverrideReasons(),
    baseline: () => dataEngineClient.baseline(),
    quality: () => dataEngineClient.quality(),
  };
}
