import { TRIAGE_STATUS } from '../constants';

export const CHAT_WELCOME_MESSAGE =
  'Hi! Ask me about any candidate in this dashboard, for example by its candidate ID.';

export const GENERIC_CHAT_REPLIES = [
  'I can explain why a candidate landed in its group. Try mentioning a candidate ID from the tables.',
  'Every status comes from the trial rules, and you always have the final say: right-click a row to override it.',
  'I only quote values from the analyzed files. Mention a candidate ID and I will show its justification.',
];

function findMentionedCandidate(message, candidates) {
  const normalizedMessage = message.toUpperCase();
  return candidates.find((candidate) => normalizedMessage.includes(candidate.candidate_id));
}

function buildCandidateReply(candidate) {
  const statusLabel = TRIAGE_STATUS[candidate.colour].label;

  return (
    `${candidate.candidate_id} (${candidate.crop}) is in the ${statusLabel} group. ` +
    `It failed ${candidate.n_fail} of ${candidate.n_trials} trials with a mean yield of ` +
    `${candidate.mean_yield_t_ha} t/ha. Justification: "${candidate.reason}".`
  );
}

// `replyCount` cycles through the generic replies so the bot does not repeat itself every time.
export function getMockChatReply(message, candidates, replyCount) {
  const candidate = findMentionedCandidate(message, candidates);

  if (candidate) {
    return buildCandidateReply(candidate);
  }

  return GENERIC_CHAT_REPLIES[replyCount % GENERIC_CHAT_REPLIES.length];
}
