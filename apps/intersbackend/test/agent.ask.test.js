import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_QUESTION_DEADLINE_MS, MAX_TOOL_ROUNDS } from '../src/constants/index.js';
import { createMemoryDb } from '../src/db/memory.js';
import { getPromptVersions } from '../src/prompts/index.js';
import { answerNumberWarning, ask, selectChatHistory } from '../src/services/agent.service.js';
import { createAnalysisService } from '../src/services/analysis.service.js';
import { createChatsService } from '../src/services/chats.service.js';
import { DataEngineError } from '../src/services/dataEngineClient.js';
import { createMemoryFileStorage } from '../src/services/fileStorage.js';

const MODEL = 'claude-haiku-4-5-20251001';
const READ_TOOLS = [
  'query_candidates',
  'get_candidate_context',
  'get_trial',
  'compare_candidates',
  'get_lineage',
  'apply_scoring',
  'explain_scoring_logic',
  'get_data_quality',
  'search',
];

const USAGE = { input_tokens: 4, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 };

function textTurn(text, usage = USAGE) {
  return { content: [{ type: 'text', text }], usage };
}

function toolTurn(name, input, id = 'toolu_1') {
  return { content: [{ type: 'tool_use', id, name, input }], usage: USAGE };
}

function engineWith(overrides = {}) {
  const runCalls = [];
  const dataEngine = {
    runCalls,
    async getTools() {
      return {
        tools: READ_TOOLS.map((name) => ({ name, input_schema: { type: 'object', properties: {} } })),
        system_prompt: 'from-engine',
      };
    },
    async runTool(name, input) {
      runCalls.push({ name, input });
      return { content: JSON.stringify({ rule_version: 'UC4_MATERIAL_V0', count: 12 }) };
    },
    ...overrides,
  };
  return dataEngine;
}

function askWith({ claude, dataEngine = engineWith(), apiKey = 'test-key', clock, history = [] } = {}) {
  return ask({
    text: 'which lines are red?',
    history,
    claude,
    dataEngine,
    model: MODEL,
    apiKey,
    clock,
  });
}

test('extractNumbers digits inside an id are not treated as an answer number', () => {
  assert.equal(answerNumberWarning('Look at SYN-MZ-00003.', []), null);
  const warning = answerNumberWarning('the value is 3', ['{"candidate_id":"SYN-MZ-00003"}']);
  assert.equal(warning.code, 'ANSWER_UNVERIFIED_NUMBERS');
  assert.match(warning.message, /\b3\b/);
});

test('a number that appears in a tool result does not warn', () => {
  assert.equal(answerNumberWarning('12 lines are red.', ['{"count":12}']), null);
});

test('a number that is not in the tool results warns and the text is kept', async () => {
  const warning = answerNumberWarning('99 lines are red.', ['{"count":12}']);
  assert.equal(warning.code, 'ANSWER_UNVERIFIED_NUMBERS');
  assert.match(warning.message, /99/);

  const followed = await askWith({
    dataEngine: engineWith({
      async runTool() {
        return { content: '{"count":12}' };
      },
    }),
    claude: {
      async completeChat({ messages }) {
        if (messages.length === 1) return toolTurn('query_candidates', { colour: 'RED' });
        return textTurn('99 lines are red.');
      },
    },
  });
  assert.equal(followed.message.status, 'ok');
  assert.equal(followed.message.text, '99 lines are red.');
  assert.equal(followed.message.analysis.warnings[0].code, 'ANSWER_UNVERIFIED_NUMBERS');
});

test('an answer with numbers and no tool calls warns', () => {
  const warning = answerNumberWarning('4 lines are red.', []);
  assert.equal(warning.code, 'ANSWER_UNVERIFIED_NUMBERS');
  assert.match(warning.message, /4/);
});

test('a count written as a word is not seen by extractNumbers and still warns', () => {
  const warning = answerNumberWarning('tres líneas son rojas.', []);
  assert.equal(warning.code, 'ANSWER_UNVERIFIED_NUMBERS');
  assert.match(warning.message, /tres/);
});

test('a tool answer stores usage, versions and the tool that ran', async () => {
  const dataEngine = engineWith();
  let rounds = 0;
  const result = await askWith({
    dataEngine,
    claude: {
      async completeChat({ messages, system, tools }) {
        rounds += 1;
        assert.equal(system, 'from-engine');
        assert.equal(tools.some((tool) => /override/i.test(tool.name)), false);
        if (messages.length === 1) return toolTurn('query_candidates', { colour: 'RED' });
        return textTurn('SYN-MZ-00003 is red.');
      },
    },
  });

  assert.equal(rounds, 2);
  assert.deepEqual(dataEngine.runCalls, [{ name: 'query_candidates', input: { colour: 'RED' } }]);
  assert.equal(result.message.text, 'SYN-MZ-00003 is red.');
  assert.equal(result.message.analysis, null);
  assert.deepEqual(result.message.tool_calls, [{ name: 'query_candidates', input: { colour: 'RED' } }]);
  assert.deepEqual(result.message.usage, {
    input_tokens: 8, output_tokens: 4, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0,
  });
  assert.deepEqual(result.message.versions, {
    explanation_prompt: null,
    rule_version: 'UC4_MATERIAL_V0',
    model: MODEL,
    chat_prompt: 'engine',
  });
  assert.equal('chat_prompt' in getPromptVersions({ ruleVersion: 'UC4_MATERIAL_V0', model: MODEL }), false);
});

test('the loop stops at the tool-round limit', async () => {
  let rounds = 0;
  const dataEngine = engineWith();
  const result = await askWith({
    dataEngine,
    claude: {
      async completeChat() {
        rounds += 1;
        return toolTurn('query_candidates', { colour: 'RED' }, `toolu_${rounds}`);
      },
    },
  });

  assert.equal(rounds, MAX_TOOL_ROUNDS);
  assert.equal(dataEngine.runCalls.length, MAX_TOOL_ROUNDS - 1);
  assert.equal(result.message.status, 'error');
  assert.equal(result.message.error.code, 'ANSWER_ROUND_LIMIT');
});

test('the question deadline ends the answer with ANSWER_TIMEOUT', async () => {
  let now = 1_000;
  let rounds = 0;
  const result = await askWith({
    clock: () => now,
    claude: {
      async completeChat() {
        rounds += 1;
        now += CHAT_QUESTION_DEADLINE_MS;
        return toolTurn('search', { query: 'red' });
      },
    },
  });

  assert.equal(rounds, 1);
  assert.equal(result.message.status, 'error');
  assert.equal(result.message.error.code, 'ANSWER_TIMEOUT');
});

test('a missing API key is a clear error and does not call the model', async () => {
  let called = false;
  const result = await askWith({
    apiKey: '',
    claude: {
      async completeChat() {
        called = true;
        return textTurn('nope');
      },
    },
  });

  assert.equal(called, false);
  assert.equal(result.message.error.code, 'LLM_UNAVAILABLE');
  assert.match(result.message.error.message, /ANTHROPIC_API_KEY is not set/);
});

test('an unreachable engine is DATA_ENGINE_UNAVAILABLE', async () => {
  const result = await askWith({
    dataEngine: engineWith({
      async getTools() {
        throw new DataEngineError(502, { code: 'DATA_ENGINE_UNAVAILABLE', message: 'Data engine is unreachable' });
      },
    }),
    claude: { async completeChat() { return textTurn('nope'); } },
  });

  assert.equal(result.message.status, 'error');
  assert.equal(result.message.kind, 'answer');
  assert.equal(result.message.error.code, 'DATA_ENGINE_UNAVAILABLE');
});

test('a tool error is returned to the model and does not become a fake answer', async () => {
  const seen = [];
  const result = await askWith({
    dataEngine: engineWith({
      async runTool() {
        throw new DataEngineError(400, { code: 'VALIDATION_ERROR', message: 'bad colour' });
      },
    }),
    claude: {
      async completeChat({ messages }) {
        seen.push(messages.at(-1));
        if (messages.length === 1) return toolTurn('query_candidates', { colour: 'NOPE' });
        return textTurn('The tool rejected that filter.');
      },
    },
  });

  assert.equal(seen[1].content[0].is_error, true);
  assert.match(seen[1].content[0].content, /VALIDATION_ERROR/);
  assert.equal(result.message.status, 'ok');
  assert.equal(result.message.text, 'The tool rejected that filter.');
  assert.deepEqual(result.message.tool_calls, []);
});

test('the chat does not call an override tool', async () => {
  const dataEngine = engineWith();
  const result = await askWith({
    dataEngine,
    claude: {
      async completeChat({ messages }) {
        if (messages.length === 1) return toolTurn('create_override', { candidate_id: 'SYN-MZ-00003', new_colour: 'GREEN' });
        return textTurn('I cannot change a colour from here.');
      },
    },
  });

  assert.deepEqual(dataEngine.runCalls, []);
  assert.equal(READ_TOOLS.some((name) => /override/i.test(name)), false);
  assert.equal(result.message.text, 'I cannot change a colour from here.');
});

test('history is the saved chat, without analysis messages or the question just asked', async () => {
  const db = createMemoryDb();
  const seen = [];
  const analysisService = createAnalysisService({
    config: { analysisMode: 'live', anthropicModel: MODEL, anthropicApiKey: 'test-key' },
    ingest: {},
    claude: {
      async completeChat({ messages }) {
        seen.push(messages.map((message) => message.content));
        return textTurn('SYN-MZ-00003 is red.');
      },
    },
    dataEngine: engineWith(),
    db,
  });
  const chats = createChatsService({ db, fileStorage: createMemoryFileStorage(), analysisService });
  const chat = await chats.createChat({});
  await db.messages.saveMessage({
    chat_id: chat.id,
    role: 'assistant',
    kind: 'analysis',
    status: 'ok',
    text: 'file summary that must not be sent',
    analysis: { summary: 'uploaded' },
  });

  await chats.postMessage(chat.id, { text: 'why is it red?', uploads: [] });
  const second = await chats.postMessage(chat.id, { text: 'what about quality?', uploads: [] });

  assert.deepEqual(seen[0], ['why is it red?']);
  assert.deepEqual(seen[1], ['why is it red?', 'SYN-MZ-00003 is red.', 'what about quality?']);
  assert.equal(JSON.stringify(seen).includes('file summary'), false);
  assert.equal(second.assistant_message.answer.versions.chat_prompt, 'engine');
  assert.equal(second.assistant_message.answer.versions.explanation_prompt, null);
  assert.deepEqual(second.assistant_message.answer.warnings, []);
  assert.equal(selectChatHistory([], '2099-01-01T00:00:00.000Z').length, 0);
});
