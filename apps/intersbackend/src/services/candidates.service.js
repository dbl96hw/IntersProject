import { notFoundError, validationError } from '../errors.js';
import { toCandidateResponse } from './responses.js';

export function createCandidatesService({ db, dataEngineClient }) {
  async function requireCandidate(id) {
    const candidate = await db.candidates.getCandidate(id);
    if (!candidate) throw notFoundError('Candidate');
    return candidate;
  }

  async function assertReasonCode(reasonCode) {
    const reasons = await dataEngineClient.listOverrideReasons();
    if (!Object.hasOwn(reasons, reasonCode)) {
      throw validationError('reason_code is not a known override reason', 'reason_code');
    }
  }

  return {
    async listCandidates(filters) {
      const result = await db.candidates.listCandidates(filters);
      return { ...result, candidates: result.candidates.map(toCandidateResponse) };
    },

    // Refresh the row's engine fields from the detail so candidate.colour and engine_detail.colour agree.
    async getCandidateDetail(id) {
      const candidate = await requireCandidate(id);
      const engineDetail = await dataEngineClient.getCandidate(candidate.candidate_id);
      const refreshed = await db.candidates.updateEngineFields(id, engineDetail);
      return { candidate: toCandidateResponse(refreshed), engine_detail: engineDetail };
    },

    // Colour changes go to the engine. The review only records what the breeder did.
    async updateCandidate(id, { new_colour: newColour, justification, reason_code: reasonCode, comment, user }) {
      const candidate = await requireCandidate(id);
      await assertReasonCode(reasonCode);

      let override = null;
      if (newColour) {
        override = await dataEngineClient.createOverride({
          candidate_id: candidate.candidate_id,
          new_colour: newColour,
          reason_code: reasonCode,
          comment,
          user,
        });
        const engineDetail = await dataEngineClient.getCandidate(candidate.candidate_id);
        await db.candidates.updateEngineFields(id, engineDetail);
      }

      await db.candidates.addReview({
        candidate_row_id: id,
        ...(newColour ? { colour: newColour } : {}),
        ...(justification ? { justification } : {}),
        reason_code: reasonCode,
        comment,
        user_name: user,
        engine_override_id: override?.id ?? null,
      });

      const refreshed = await db.candidates.getCandidate(id);
      return { candidate: toCandidateResponse(refreshed), override };
    },

    // A pass / no pass never changes the colour. It only appends a review.
    async recordDecision(id, { decision, reason_code: reasonCode, comment, user }) {
      await requireCandidate(id);
      if (reasonCode) await assertReasonCode(reasonCode);

      await db.candidates.addReview({
        candidate_row_id: id,
        decision,
        reason_code: reasonCode,
        comment,
        user_name: user,
      });

      const refreshed = await db.candidates.getCandidate(id);
      return { candidate: toCandidateResponse(refreshed) };
    },
  };
}
