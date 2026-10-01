import { ANALYSIS_MODES } from '../constants/index.js';
import { notFoundError } from '../errors.js';
import { loadSample } from '../mocks/index.js';
import { toCandidateResponse } from './responses.js';

export function createCandidatesService({ config, db, dataEngineClient }) {
  async function fetchEngineDetail(candidateId) {
    if (config.analysisMode === ANALYSIS_MODES.LIVE) return dataEngineClient.getCandidate(candidateId);
    const detail = loadSample('engine')[candidateId];
    if (!detail) throw notFoundError('Engine detail for this candidate');
    return detail;
  }

  return {
    async listCandidates(filters) {
      const result = await db.candidates.listCandidates(filters);
      return { ...result, candidates: result.candidates.map(toCandidateResponse) };
    },

    // Refresh the row's engine fields from the detail so candidate.colour and engine_detail.colour agree.
    async getCandidateDetail(id) {
      const candidate = await db.candidates.getCandidate(id);
      if (!candidate) throw notFoundError('Candidate');
      const engineDetail = await fetchEngineDetail(candidate.candidate_id);
      const refreshed = await db.candidates.updateEngineFields(id, engineDetail);
      return { candidate: toCandidateResponse(refreshed), engine_detail: engineDetail };
    },
  };
}
