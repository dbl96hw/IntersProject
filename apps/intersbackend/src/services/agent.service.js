// Text-only chat. The engine owns the numbers: Claude may call the read-only tools from GET /tools,
// and a number in the final text must appear in those tool results. History comes from saved messages.

import {
  BLOCKED_CHAT_TOOL_PATTERN,
  CHAT_PROMPT_SOURCE,
  CHAT_QUESTION_DEADLINE_MS,
  ENTITY_ID_PATTERN,
  ERROR_CODES,
  HTTP_STATUS,
  MAX_CHAT_HISTORY_MESSAGES,
  MAX_TOOL_ROUNDS,
  MESSAGE_KINDS,
  MESSAGE_STATUS,
  NUMBER_WORDS,
  ROLES,
  WARNING_CODES,
} from '../constants/index.js';
import { addUsage, emptyUsage } from '../llm/claude.client.js';
import { extractNumbers, normaliseText } from '../llm/evidence.check.js';
import { DataEngineError } from './dataEngineClient.js';

const entityIdPattern = () => new RegExp(ENTITY_ID_PATTERN.source, 'gi');

function withoutEntityIds(text) {
  return String(text).replace(entityIdPattern(), ' ');
}

function numberWordsOutside(text, corpusText) {
  const corpusWords = new Set(normaliseText(corpusText).match(/\p{L}+/gu) ?? []);
  return (String(text).match(/\p{L}+/gu) ?? []).filter((word) => {
    const normalised = normaliseText(word);
    return NUMBER_WORDS.has(normalised) && !corpusWords.has(normalised);
  });
}

// Digits inside an id (SYN-MZ-00003) are not a number. extractNumbers would otherwise keep "3".
// Spelled counts are invisible to extractNumbers; they are checked with NUMBER_WORDS.
export function answerNumberWarning(text, toolContents) {
  const corpusText = toolContents.join('\n');
  const corpusNumbers = extractNumbers(withoutEntityIds(corpusText));
  const missingNumbers = [...extractNumbers(withoutEntityIds(text))].filter((value) => value && !corpusNumbers.has(value));
  const missingWords = numberWordsOutside(text, corpusText);
  if (missingNumbers.length === 0 && missingWords.length === 0) return null;
  const parts = [];
  if (missingNumbers.length > 0) parts.push(`numbers (${missingNumbers.join(', ')})`);
  if (missingWords.length > 0) parts.push(`counts written as words (${missingWords.join(', ')})`);
  return {
    code: WARNING_CODES.ANSWER_UNVERIFIED_NUMBERS,
    message: `This answer includes ${parts.join(' and ')} that were not in the tool results.`,
    file: null,
  };
}

function ruleVersionIn(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.rule_version === 'string') return value.rule_version;
  for (const child of Object.values(value)) {
    const found = ruleVersionIn(child);
    if (found) return found;
  }
  return null;
}

function parseToolContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Prior user texts and successful answers. Analysis bubbles are the file path, not the conversation.
// `before` drops the question being asked now (it is passed separately) and anything saved after it.
export function selectChatHistory(messages, before) {
  const eligible = messages.filter((message) => {
    if (before && message.created_at >= before) return false;
    if (message.kind === MESSAGE_KINDS.ANALYSIS) return false;
    if (message.role === ROLES.USER && message.text) return true;
    return message.kind === MESSAGE_KINDS.ANSWER && message.status === MESSAGE_STATUS.OK && Boolean(message.text);
  });
  const turns = [];
  for (const message of eligible.slice(-MAX_CHAT_HISTORY_MESSAGES)) {
    const role = message.role === ROLES.USER ? 'user' : 'assistant';
    if (turns.at(-1)?.role === role) turns[turns.length - 1] = { role, text: message.text };
    else turns.push({ role, text: message.text });
  }
  while (turns[0]?.role === 'assistant') turns.shift();
  if (turns.at(-1)?.role === 'user') turns.pop();
  return turns;
}

function answerError(code, message) {
  return {
    message: {
      kind: MESSAGE_KINDS.ANSWER,
      status: MESSAGE_STATUS.ERROR,
      error: { code, message },
    },
    candidates: [],
  };
}

const isEngineDown = (err) => err instanceof DataEngineError && err.status === HTTP_STATUS.BAD_GATEWAY;

function textOf(blocks) {
  return blocks.filter((block) => block.type === 'text' && block.text).map((block) => block.text).join('\n').trim();
}

function toolResultContent(result) {
  if (typeof result?.content === 'string') return result.content;
  return JSON.stringify(result?.content ?? result ?? {});
}

export async function ask({
  text,
  history = [],
  claude,
  dataEngine,
  model,
  apiKey,
  clock = Date.now,
}) {
  if (!apiKey) return answerError(ERROR_CODES.LLM_UNAVAILABLE, 'ANTHROPIC_API_KEY is not set');
  if (!claude?.completeChat) return answerError(ERROR_CODES.LLM_UNAVAILABLE, 'The assistant is unavailable');

  const startedAt = clock();
  const timedOut = () => clock() - startedAt >= CHAT_QUESTION_DEADLINE_MS;

  let listed;
  try {
    listed = await dataEngine.getTools();
  } catch (err) {
    if (isEngineDown(err)) return answerError(err.code, err.message);
    return answerError(ERROR_CODES.DATA_ENGINE_UNAVAILABLE, err?.message || 'Data engine is unreachable');
  }

  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  const allowed = new Set(tools.map((tool) => tool.name));
  const systemPrompt = typeof listed?.system_prompt === 'string' ? listed.system_prompt : '';
  const messages = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: text },
  ];
  let usage = emptyUsage();
  const toolCalls = [];
  const toolContents = [];
  let ruleVersion = null;

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    if (timedOut()) {
      return answerError(ERROR_CODES.ANSWER_TIMEOUT, 'The question took too long. Ask again with a narrower question.');
    }

    let turn;
    try {
      turn = await claude.completeChat({ system: systemPrompt, messages, tools });
    } catch (err) {
      return answerError(err?.code || ERROR_CODES.LLM_UNAVAILABLE, err?.message || 'The assistant is unavailable');
    }
    usage = addUsage(usage, turn.usage ?? emptyUsage());

    const blocks = turn.content ?? [];
    const toolUses = blocks.filter((block) => block.type === 'tool_use');
    if (toolUses.length === 0) {
      const answerText = textOf(blocks);
      if (!answerText) return answerError(ERROR_CODES.LLM_UNAVAILABLE, 'The assistant returned no answer.');
      const warning = answerNumberWarning(answerText, toolContents);
      return {
        message: {
          kind: MESSAGE_KINDS.ANSWER,
          status: MESSAGE_STATUS.OK,
          text: answerText,
          tool_calls: toolCalls,
          usage,
          versions: {
            explanation_prompt: null,
            rule_version: ruleVersion,
            model,
            chat_prompt: CHAT_PROMPT_SOURCE,
          },
          analysis: warning ? { warnings: [warning] } : null,
        },
        candidates: [],
      };
    }

    if (round === MAX_TOOL_ROUNDS) {
      return answerError(
        ERROR_CODES.ANSWER_ROUND_LIMIT,
        'The assistant stopped after the tool-round limit without a final answer.',
      );
    }

    messages.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const toolUse of toolUses) {
      if (timedOut()) {
        return answerError(ERROR_CODES.ANSWER_TIMEOUT, 'The question took too long. Ask again with a narrower question.');
      }
      const blocked = BLOCKED_CHAT_TOOL_PATTERN.test(toolUse.name) || !allowed.has(toolUse.name);
      if (blocked) {
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: JSON.stringify({ error: { code: 'UNKNOWN_TOOL', message: 'This tool is not available.' } }),
        });
        continue;
      }

      try {
        const result = await dataEngine.runTool(toolUse.name, toolUse.input ?? {});
        const content = toolResultContent(result);
        const parsed = parseToolContent(content);
        if (!ruleVersion) ruleVersion = ruleVersionIn(parsed);
        toolCalls.push({ name: toolUse.name, input: toolUse.input ?? {} });
        toolContents.push(content);
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content });
      } catch (err) {
        if (isEngineDown(err)) return answerError(err.code, err.message);
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: JSON.stringify({
            error: { code: err?.code || 'DATA_ENGINE_ERROR', message: err?.message || 'Tool failed' },
          }),
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  return answerError(
    ERROR_CODES.ANSWER_ROUND_LIMIT,
    'The assistant stopped after the tool-round limit without a final answer.',
  );
}
