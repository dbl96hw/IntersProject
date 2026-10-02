// Claude client for the two forced-tool jobs: extracting records from documents and writing justifications.
// Every tool input is validated with zod; justifications are then checked against the engine's evidence.
// Logs carry model, tool, batch, duration, tokens and cost only: never the API key, prompts or file contents.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import {
  ERROR_CODES,
  HTTP_STATUS,
  LLM_MAX_TOKENS,
  LLM_RETRY_DELAY_MS,
  LLM_TIMEOUT_MS,
  LLM_TOOL_NAMES,
  MIN_SERVER_ERROR_STATUS,
  MODEL_PRICING_PER_MTOK,
  PROMPT_IDS,
  RETRYABLE_STATUSES,
  STOP_REASON_MAX_TOKENS,
  TOKENS_PER_MTOK,
  WARNING_CODES,
} from '../constants/index.js';
import { HttpError, validationError } from '../errors.js';
import { loadPrompt } from '../prompts/index.js';
import { checkJustification, engineFallback } from './evidence.check.js';
import { TOOLS } from './tools.js';

const MAX_ISSUES_IN_CORRECTION = 20;
const MAX_API_ERROR_LENGTH = 300;
const PDF_MEDIA_TYPE = 'application/pdf';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const warning = (code, message, file = null) => ({ code, message, file });
const roundCost = (cost) => (cost === null ? null : Math.round(cost * 1e6) / 1e6);

export function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 };
}

export function usageFrom(apiUsage, model) {
  const usage = {
    input_tokens: apiUsage?.input_tokens ?? 0,
    output_tokens: apiUsage?.output_tokens ?? 0,
    cache_read_tokens: apiUsage?.cache_read_input_tokens ?? 0,
    cache_write_tokens: apiUsage?.cache_creation_input_tokens ?? 0,
  };
  const price = MODEL_PRICING_PER_MTOK[model];
  const cost = price
    ? (usage.input_tokens * price.input + usage.output_tokens * price.output
      + usage.cache_write_tokens * price.cache_write + usage.cache_read_tokens * price.cache_read) / TOKENS_PER_MTOK
    : null;
  return { ...usage, cost_usd: roundCost(cost) };
}

// One unknown cost makes the total unknown: a partial sum would understate the spend.
export function addUsage(a, b) {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
    cost_usd: a.cost_usd === null || b.cost_usd === null ? null : roundCost(a.cost_usd + b.cost_usd),
  };
}

const isRetryableStatus = (status) => typeof status === 'number'
  && (RETRYABLE_STATUSES.includes(status) || status >= MIN_SERVER_ERROR_STATUS);

function chunk(items, size) {
  const chunks = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

function describeIssues(issues) {
  return issues.slice(0, MAX_ISSUES_IN_CORRECTION)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

// Returns { input } for a usable tool call, or { problem, toolUse } describing why it is not.
function readToolOutput(response, tool) {
  const toolName = tool.definition.name;
  const toolUse = (response.content ?? []).find((block) => block.type === 'tool_use' && block.name === toolName);
  if (response.stop_reason === STOP_REASON_MAX_TOKENS) {
    return { toolUse, problem: 'output was truncated (max_tokens); return a shorter result' };
  }
  if (!toolUse) return { problem: `the response has no ${toolName} tool call` };
  const parsed = tool.schema.safeParse(toolUse.input);
  if (!parsed.success) return { toolUse, problem: describeIssues(parsed.error.issues) };
  return { input: parsed.data };
}

// A tool_result must point at a tool_use id; without one the correction goes as plain text.
function correctionTurn(toolName, { toolUse, problem }) {
  const text = `Invalid ${toolName} input: ${problem}. Call ${toolName} again with corrected input.`;
  const content = toolUse
    ? [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: text }]
    : [{ type: 'text', text }];
  return { role: 'user', content };
}

function outputInvalidError(toolName, problem, usage) {
  const err = new HttpError(
    HTTP_STATUS.BAD_GATEWAY,
    ERROR_CODES.CLAUDE_OUTPUT_INVALID,
    `Claude returned invalid ${toolName} output twice (${problem})`,
  );
  err.usage = usage;
  return err;
}

// The SDK's APIError.error is the response body: { type: 'error', error: { type, message } }.
// Only the API's own type and message are kept; headers, the request and the key never are.
export function describeApiError(err, apiKey) {
  const body = err?.error?.error ?? err?.error;
  const type = body?.type && body.type !== 'error' ? body.type : err?.type ?? err?.name;
  const message = body?.message ?? err?.message ?? '';
  let text = [type, message].filter(Boolean).join(': ').replace(/\s+/g, ' ').trim();
  if (apiKey) text = text.replaceAll(apiKey, '[redacted]');
  return text.length > MAX_API_ERROR_LENGTH ? `${text.slice(0, MAX_API_ERROR_LENGTH)}...` : text;
}

function unavailableError(err, detail) {
  const status = err?.status ?? 'none';
  const message = `Claude request failed (status ${status}${detail ? `, ${detail}` : ''})`;
  const wrapped = new HttpError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.LLM_UNAVAILABLE, message);
  wrapped.upstreamStatus = err?.status;
  return wrapped;
}

function documentBlock({ filename, media, text }) {
  if (media?.media_type === PDF_MEDIA_TYPE) {
    return { type: 'document', source: { type: 'base64', media_type: media.media_type, data: media.data }, title: filename };
  }
  if (media) return { type: 'image', source: { type: 'base64', media_type: media.media_type, data: media.data } };
  if (typeof text === 'string') {
    return { type: 'text', text: `<document filename=${JSON.stringify(filename)}>\n${text}\n</document>` };
  }
  throw validationError('extractRecords needs media or text', 'media');
}

function breederBlocks(breederText) {
  const text = breederText?.trim();
  return text ? [{ type: 'text', text: `<breeder_text>\n${text}\n</breeder_text>` }] : [];
}

export function createClaudeClient({
  anthropic,
  model = config.anthropicModel,
  batchSize = config.batchSize,
  maxParallelBatches = config.maxParallelBatches,
  retryDelayMs = LLM_RETRY_DELAY_MS,
  logger = console,
  apiKey = config.anthropicApiKey,
} = {}) {
  if (!model) throw new Error('ANTHROPIC_MODEL is not set');
  // The SDK's own retries are off so that only the rule below applies (one retry, 429 / 529 / 5xx).
  const client = anthropic ?? new Anthropic({ apiKey, maxRetries: 0, timeout: LLM_TIMEOUT_MS });

  async function createWithRetry(body) {
    try {
      return await client.messages.create(body);
    } catch (err) {
      if (!isRetryableStatus(err?.status)) throw err;
      await wait(retryDelayMs);
      return client.messages.create(body);
    }
  }

  async function send(body, { toolName, label, attempt }) {
    const tag = `claude: model=${model} tool=${toolName} batch=${label} attempt=${attempt}`;
    const started = Date.now();
    let response;
    try {
      response = await createWithRetry(body);
    } catch (err) {
      const detail = describeApiError(err, apiKey);
      logger.error(`${tag} failed status=${err?.status ?? 'none'} duration_ms=${Date.now() - started} error=${detail || 'unknown'}`);
      throw unavailableError(err, detail);
    }
    const usage = usageFrom(response.usage, model);
    logger.log(`${tag} duration_ms=${Date.now() - started} input_tokens=${usage.input_tokens} `
      + `output_tokens=${usage.output_tokens} cache_read_tokens=${usage.cache_read_tokens} `
      + `cache_write_tokens=${usage.cache_write_tokens} cost_usd=${usage.cost_usd ?? 'unknown'}`);
    return { response, usage };
  }

  async function callTool({ prompt, toolName, content, label = '-' }) {
    const tool = TOOLS[toolName];
    if (!tool) throw new Error(`Unknown tool "${toolName}"`);
    const request = {
      model,
      max_tokens: LLM_MAX_TOKENS,
      system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
      tools: [tool.definition],
      tool_choice: { type: 'tool', name: toolName },
    };

    let messages = [{ role: 'user', content }];
    let usage = emptyUsage();
    let output;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const sent = await send({ ...request, messages }, { toolName, label, attempt });
      usage = addUsage(usage, sent.usage);
      output = readToolOutput(sent.response, tool);
      if (output.input) return { input: output.input, usage };
      logger.error(`claude: tool=${toolName} batch=${label} attempt=${attempt} invalid output (${output.problem})`);
      const assistantTurn = sent.response.content?.length ? [{ role: 'assistant', content: sent.response.content }] : [];
      messages = [...messages, ...assistantTurn, correctionTurn(toolName, output)];
    }
    throw outputInvalidError(toolName, output.problem, usage);
  }

  async function extractRecords({ filename, media, text, breederText }) {
    const content = [
      { type: 'text', text: `Extract the records from ${JSON.stringify(filename)}.` },
      documentBlock({ filename, media, text }),
      ...breederBlocks(breederText),
    ];
    const { input, usage } = await callTool({
      prompt: loadPrompt(PROMPT_IDS.EXTRACTION),
      toolName: LLM_TOOL_NAMES.SUBMIT_RECORDS,
      content,
      label: filename,
    });
    return {
      tables: input.tables,
      warnings: input.warnings.map((message) => warning(WARNING_CODES.CLAUDE_NOTE, message, filename)),
      usage,
    };
  }

  async function explainBatch(contexts, breederText, { label = '-' } = {}) {
    const contextText = contexts
      .map((payload) => `<candidate_context>${JSON.stringify(payload)}</candidate_context>`)
      .join('\n');
    const { input, usage } = await callTool({
      prompt: loadPrompt(PROMPT_IDS.EXPLANATION),
      toolName: LLM_TOOL_NAMES.SUBMIT_JUSTIFICATIONS,
      content: [{ type: 'text', text: contextText }, ...breederBlocks(breederText)],
      label,
    });

    const itemsById = new Map();
    input.items.forEach((item) => {
      if (!itemsById.has(item.candidate_id)) itemsById.set(item.candidate_id, item);
    });

    const warnings = input.warnings.map((message) => warning(WARNING_CODES.CLAUDE_NOTE, message));
    const missing = [];
    const rejected = [];
    const results = contexts.map((payload) => {
      const item = itemsById.get(payload.candidate_id);
      if (!item) {
        missing.push(payload.candidate_id);
        return engineFallback(payload);
      }
      const checked = checkJustification(payload, item);
      if (checked.warning) warnings.push(checked.warning);
      if (checked.rejection) rejected.push(checked.rejection);
      return checked.result;
    });
    if (missing.length > 0) {
      warnings.push(warning(
        WARNING_CODES.EXPLANATION_FAILED,
        `Claude returned no justification for ${missing.join(', ')}; the engine's reason is shown instead.`,
      ));
    }
    // `rejected` is internal (logs, claude:smoke); callers must not put it in API responses.
    return { results, summary: input.summary, warnings, rejected, usage };
  }

  async function explainSafely(batch, breederText, label) {
    try {
      return await explainBatch(batch, breederText, { label });
    } catch (err) {
      logger.error(`claude: batch=${label} failed (${err?.code ?? err?.name}: ${err?.message})`);
      return {
        results: batch.map(engineFallback),
        summary: null,
        warnings: [warning(
          WARNING_CODES.EXPLANATION_FAILED,
          `Justifications for ${batch.length} candidate(s) could not be generated; the engine's reason is shown instead.`,
        )],
        rejected: [],
        usage: err?.usage ?? emptyUsage(),
      };
    }
  }

  // Runs at most maxParallelBatches batches at a time; results keep the order of contexts.
  async function explainAll(contexts, breederText) {
    const batches = chunk(contexts, batchSize);
    const outcomes = new Array(batches.length);
    let next = 0;
    async function worker() {
      while (next < batches.length) {
        const index = next;
        next += 1;
        outcomes[index] = await explainSafely(batches[index], breederText, `${index + 1}/${batches.length}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxParallelBatches, batches.length) }, worker));

    return {
      results: outcomes.flatMap((outcome) => outcome.results),
      summary: outcomes.map((outcome) => outcome.summary).filter(Boolean).join(' ') || null,
      warnings: outcomes.flatMap((outcome) => outcome.warnings),
      rejected: outcomes.flatMap((outcome) => outcome.rejected),
      usage: outcomes.reduce((total, outcome) => addUsage(total, outcome.usage), emptyUsage()),
    };
  }

  return { callTool, extractRecords, explainBatch, explainAll };
}
