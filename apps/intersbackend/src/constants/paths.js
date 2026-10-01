/**
 * Backend route path constants.
 * Keep in sync with frontend path strings when the contract is shared by name.
 * The contract for every /api path is docs/api-contract.md.
 */

export const ROOT_PATH = '/';
export const HEALTH_PATH = '/health';

export const API_PREFIX = '/api';

export const API_PATHS = {
  CHATS: `${API_PREFIX}/chats`,
  CHAT: `${API_PREFIX}/chats/:id`,
  CHAT_MESSAGES: `${API_PREFIX}/chats/:id/messages`,
  MESSAGE_RETRY: `${API_PREFIX}/chats/:id/messages/:messageId/retry`,
  CANDIDATES: `${API_PREFIX}/candidates`,
  CANDIDATE: `${API_PREFIX}/candidates/:id`,
  CANDIDATE_DECISION: `${API_PREFIX}/candidates/:id/decision`,
  ENGINE_OVERRIDE_REASONS: `${API_PREFIX}/engine/override-reasons`,
  ENGINE_BASELINE: `${API_PREFIX}/engine/baseline`,
  ENGINE_QUALITY: `${API_PREFIX}/engine/quality`,
};
