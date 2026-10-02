// Runs an analysis (files) or an answer (question only) and returns what to save:
// the assistant message fields (as accepted by db.messages.saveMessage) and the candidate rows.

import { ANALYSIS_MODES, ERROR_CODES, MESSAGE_KINDS, MESSAGE_STATUS } from '../constants/index.js';
import { loadSample } from '../mocks/index.js';
import { fileKindOf } from './responses.js';

const MOCK_SOURCE = 'SAMPLE';
const MOCK_INGESTION_MESSAGE = 'Mock mode: file not sent to the engine';

function mockIngestion(files) {
  return files.map((file) => ({
    file: file.name,
    kind: fileKindOf(file.name),
    accepted: true,
    source: MOCK_SOURCE,
    rows: null,
    rows_added: null,
    duplicates_ignored: null,
    conflicts: null,
    message: MOCK_INGESTION_MESSAGE,
  }));
}

function mockAnalysis(files) {
  const { candidates, usage, versions, ...analysis } = loadSample('analysis');
  return {
    message: {
      kind: MESSAGE_KINDS.ANALYSIS,
      status: MESSAGE_STATUS.OK,
      analysis: { ...analysis, ingestion: mockIngestion(files) },
      usage,
      versions,
    },
    candidates,
  };
}

function mockAnswer() {
  const { text, tool_calls: toolCalls, usage } = loadSample('answer');
  return {
    message: { kind: MESSAGE_KINDS.ANSWER, status: MESSAGE_STATUS.OK, text, tool_calls: toolCalls, usage },
    candidates: [],
  };
}

function notImplementedLive(kind) {
  return {
    message: {
      kind,
      status: MESSAGE_STATUS.ERROR,
      error: { code: ERROR_CODES.LLM_UNAVAILABLE, message: 'Live analysis is not implemented yet' },
    },
    candidates: [],
  };
}

export function createAnalysisService({ config }) {
  return {
    // files: [{ name, mime_type, size_bytes, buffer }]
    async handleMessage({ files }) {
      const hasFiles = files.length > 0;
      if (config.analysisMode === ANALYSIS_MODES.LIVE) {
        return notImplementedLive(hasFiles ? MESSAGE_KINDS.ANALYSIS : MESSAGE_KINDS.ANSWER);
      }
      return hasFiles ? mockAnalysis(files) : mockAnswer();
    },
  };
}
