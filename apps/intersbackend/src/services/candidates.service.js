import { ANALYSIS_MODES } from '../constants/index.js';
import { notFoundError, notImplementedError } from '../errors.js';
import { loadSample } from '../mocks/index.js';
import { toCandidateResponse } from './responses.js';

export function createCandidatesService({ config, db, dataEngineClient }) {
  const isLive = config.analysisMode === ANALYSIS_MODES.LIVE;

  async function fetchEngineDetail(candidateId) {
    if (isLive) return dataEngineClient.getCandidate(candidateId);
    const detail = loadSample('engine')[candidateId];
    if (!detail) throw notFoundError('Engine detail for this candidate');
    return detail;
  }

  async function requireLiveCandidate(id, notImplementedMessage) {
    if (!isLive) throw notImplementedError(notImplementedMessage);
    const candidate = await db.candidates.getCandidate(id);
    if (!candidate) throw notFoundError('Candidate');
    return candidate;
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

    // A colour change is the engine's override. The review is written only after that call succeeds.
    async updateCandidate(id, body) {
      const candidate = await requireLiveCandidate(id, 'Editing a candidate is not implemented yet (ticket 3)');
      let override = null;
      if (body.new_colour) {
        override = await dataEngineClient.createOverride({
          candidate_id: candidate.candidate_id,
          new_colour: body.new_colour,
          reason_code: body.reason_code,
          comment: body.comment,
          user: body.user,
        });
        const engineRow = await dataEngineClient.getCandidate(candidate.candidate_id);
        await db.candidates.updateEngineFields(id, engineRow);
      }
      await db.candidates.addReview({
        candidate_row_id: id,
        user_name: body.user,
        reason_code: body.reason_code,
        comment: body.comment,
        ...(body.new_colour ? { colour: override.new_colour } : {}),
        ...(body.justification ? { justification: body.justification } : {}),
        ...(override ? { engine_override_id: override.id } : {}),
      });
      const refreshed = await db.candidates.getCandidate(id);
      return { candidate: toCandidateResponse(refreshed), override };
    },

    // Pass / no pass stays on our side. It never asks the engine to change a colour.
    async recordDecision(id, body) {
      await requireLiveCandidate(id, 'Recording a decision is not implemented yet (ticket 3)');
      await db.candidates.addReview({
        candidate_row_id: id,
        user_name: body.user,
        decision: body.decision,
        ...(body.reason_code ? { reason_code: body.reason_code } : {}),
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
      });
      const refreshed = await db.candidates.getCandidate(id);
      return { candidate: toCandidateResponse(refreshed) };
    },
  };
}
