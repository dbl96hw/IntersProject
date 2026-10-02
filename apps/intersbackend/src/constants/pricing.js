/**
 * Claude prices in USD per million tokens, keyed by model id. Cache write is the 5-minute ephemeral rate.
 * Verify against Anthropic's pricing page (https://www.anthropic.com/pricing) before relying on cost_usd.
 * A model missing here gets cost_usd null instead of a guess.
 */

export const MODEL_PRICING_PER_MTOK = {
  'claude-sonnet-5-5': { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
};

export const TOKENS_PER_MTOK = 1_000_000;
