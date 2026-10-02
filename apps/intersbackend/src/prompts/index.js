import { readFileSync } from 'node:fs';
import { ENGINE_SOURCES, PROMPT_IDS } from '../constants/index.js';

export function renderPrompt(id, template) {
  const text = template.replaceAll('{{SOURCES}}', ENGINE_SOURCES.join(', '));
  if (text.includes('{{')) throw new Error(`Prompt "${id}" has an unreplaced placeholder`);
  return text;
}

const readPrompt = (id) => readFileSync(new URL(`./${id}.md`, import.meta.url), 'utf8');

// Read once at startup so a missing or broken prompt fails fast, not on the first request.
const PROMPTS = new Map(Object.values(PROMPT_IDS).map((id) => [id, renderPrompt(id, readPrompt(id))]));

export function loadPrompt(id) {
  const prompt = PROMPTS.get(id);
  if (prompt === undefined) throw new Error(`Unknown prompt "${id}"`);
  return prompt;
}

// Shape of messages.versions (docs/api-contract.md).
export function getPromptVersions({ ruleVersion, model }) {
  return { explanation_prompt: PROMPT_IDS.EXPLANATION, rule_version: ruleVersion, model };
}
