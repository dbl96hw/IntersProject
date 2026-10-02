import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENGINE_SOURCES, LLM_TOOL_NAMES, PROMPT_IDS } from '../src/constants/index.js';
import { justificationsInputSchema, recordsInputSchema, TOOLS } from '../src/llm/tools.js';
import { loadPrompt, renderPrompt } from '../src/prompts/index.js';

const validItem = {
  candidate_id: 'SYN-MZ-00001',
  justification: 'Fails in 3 of 5 trials; DISEASE_SCORE = 7.7 is above the threshold of 5.',
  cited_values: [{ field: 'DISEASE_SCORE', record: 'SYN-TR-0001', value: 7.7 }],
  confidence: 'high',
};

test('tool definitions are generated from the zod schemas', () => {
  const records = TOOLS[LLM_TOOL_NAMES.SUBMIT_RECORDS].definition;
  const justifications = TOOLS[LLM_TOOL_NAMES.SUBMIT_JUSTIFICATIONS].definition;

  assert.equal(records.name, 'submit_records');
  assert.equal(records.input_schema.type, 'object');
  assert.equal(records.input_schema.$schema, undefined);
  assert.deepEqual(records.input_schema.properties.tables.items.properties.source.enum, ENGINE_SOURCES);
  assert.equal(justifications.name, 'submit_justifications');
  assert.deepEqual(
    justifications.input_schema.properties.items.items.properties.confidence.enum,
    ['high', 'medium', 'low'],
  );
});

test('submit_records accepts string, number and null values and rejects unknown sources', () => {
  const tables = [{ source: 'genomics', records: [{ MATERIAL_GUID: 'A-1', GENOMIC_BREEDING_VALUE: 104.2, QC_CALL_RATE_PCT: null }] }];
  assert.equal(recordsInputSchema.safeParse({ tables, warnings: [] }).success, true);
  assert.equal(recordsInputSchema.safeParse({ tables: [{ ...tables[0], source: 'weather' }], warnings: [] }).success, false);
  assert.equal(recordsInputSchema.safeParse({ tables: [{ ...tables[0], records: [{ X: true }] }], warnings: [] }).success, false);
});

test('submit_justifications rejects a bad confidence and more than 3 sentences', () => {
  const parse = (item) => justificationsInputSchema.safeParse({ items: [item], summary: 's', warnings: [] });
  assert.equal(parse(validItem).success, true);
  assert.equal(parse({ ...validItem, confidence: 'certain' }).success, false);
  assert.equal(parse({ ...validItem, justification: 'One. Two. Three. Four.' }).success, false);
  assert.equal(parse({ ...validItem, justification: 'Yield is 9.5 t/ha. Disease is 7.7. Three of 5 trials fail.' }).success, true);
});

test('prompts replace {{SOURCES}} and reject leftover placeholders', () => {
  const extraction = loadPrompt(PROMPT_IDS.EXTRACTION);
  assert.ok(extraction.includes(ENGINE_SOURCES.join(', ')));
  assert.equal(extraction.includes('{{'), false);
  assert.ok(loadPrompt(PROMPT_IDS.EXPLANATION).includes('<candidate_context>'));
  assert.throws(() => renderPrompt('x', 'Sources: {{SOURCES}} {{OTHER}}'), /unreplaced placeholder/);
  assert.throws(() => loadPrompt('missing.v1'), /Unknown prompt/);
});
