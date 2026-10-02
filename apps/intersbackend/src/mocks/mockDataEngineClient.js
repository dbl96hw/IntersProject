// Stand-in for the Python engine while ANALYSIS_MODE=mock.
// Same methods the backend calls, backed by the sample JSON, plus an in-memory
// override log so a colour change survives the next GET /api/candidates/:id.

import { randomUUID } from 'node:crypto';
import { COLOURS, ERROR_CODES, HTTP_STATUS } from '../constants/index.js';
import { DataEngineError } from '../services/dataEngineClient.js';
import { loadSample } from './index.js';

const CANDIDATE_LEVEL = 'candidate';
const OTHER_REASON_CODE = 'OTHER';

function engineError(status, code, message, field = null) {
  return new DataEngineError(status, { code, message, field });
}

export function createMockDataEngineClient() {
  const overrides = [];

  function baseDetail(candidateId) {
    const detail = loadSample('engine')[candidateId];
    if (!detail) {
      throw engineError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, `unknown id: ${candidateId}`);
    }
    return detail;
  }

  function latestOverride(candidateId) {
    return overrides.findLast((entry) => entry.level === CANDIDATE_LEVEL && entry.record === candidateId) ?? null;
  }

  return {
    // /health does not call this in mock mode (it reports engine: "skipped").
    health: async () => ({ healthy: true }),
    listOverrideReasons: async () => loadSample('override-reasons'),
    baseline: async () => loadSample('baseline'),
    quality: async () => loadSample('quality'),

    async getCandidate(candidateId) {
      const detail = baseDetail(candidateId);
      const override = latestOverride(candidateId);
      if (!override) return detail;
      return {
        ...detail,
        colour: override.new_colour,
        overridden: true,
        override: structuredClone(override),
      };
    },

    async createOverride({
      candidate_id: candidateId,
      new_colour: newColour,
      reason_code: reasonCode,
      comment,
      user,
    }) {
      const detail = baseDetail(candidateId);
      const reasons = loadSample('override-reasons');
      if (!Object.hasOwn(reasons, reasonCode)) {
        throw engineError(
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
          `reason_code must be one of ${Object.keys(reasons).join(', ')}`,
          'reason_code',
        );
      }
      if (!Object.values(COLOURS).includes(newColour)) {
        throw engineError(
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
          `new_colour must be one of ${Object.values(COLOURS).join(', ')}`,
          'new_colour',
        );
      }
      const trimmedComment = (comment ?? '').trim();
      if (reasonCode === OTHER_REASON_CODE && trimmedComment === '') {
        throw engineError(
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
          'reason_code OTHER requires a comment',
          'comment',
        );
      }

      const entry = {
        id: randomUUID(),
        timestamp_utc: new Date().toISOString(),
        user,
        level: CANDIDATE_LEVEL,
        record: candidateId,
        engine_colour: detail.engine_colour,
        new_colour: newColour,
        reason_code: reasonCode,
        comment: trimmedComment,
        rule_version: detail.rule_version,
      };
      overrides.push(entry);
      return structuredClone(entry);
    },
  };
}
