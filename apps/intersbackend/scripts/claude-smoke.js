// Live smoke test of the explanation path: fetch the llm-context of a colour-mixed sample of candidates
// (2 RED, 1 GREEN, 2 AMBER) from the data engine at DATA_ENGINE_URL, run explainAll with the real Claude API
// and print what came back.
// Usage (engine running, ANALYSIS_MODE=live): npm run claude:smoke -w apps/intersbackend
// Optional: SMOKE_BREEDER_TEXT="Explica en español por qué fallan" to send a breeder message.
// Prints ids, engine colours, verification, sources, justifications, Claude's summary, full warnings, rejected
// Claude texts (with the offending token) and usage; never the API key or engine payloads.

import { config } from '../src/config/env.js';
import { ANALYSIS_MODES, COLOURS } from '../src/constants/index.js';
import { createClaudeClient } from '../src/llm/claude.client.js';
import { createDataEngineClient } from '../src/services/dataEngineClient.js';

const SMOKE_MIX = { [COLOURS.RED]: 2, [COLOURS.GREEN]: 1, [COLOURS.AMBER]: 2 };

async function pickCandidateIds(dataEngine) {
  const ids = [];
  for (const [colour, wanted] of Object.entries(SMOKE_MIX)) {
    const candidates = await dataEngine.listCandidates({ colour, limit: wanted });
    if (candidates.length < wanted) {
      console.log(`note: only ${candidates.length} ${colour} candidate(s) available (wanted ${wanted})`);
    }
    ids.push(...candidates.map((candidate) => candidate.candidate_id));
  }
  return ids;
}

async function run() {
  if (config.analysisMode !== ANALYSIS_MODES.LIVE) {
    console.error('claude:smoke needs ANALYSIS_MODE=live (and the data engine running at DATA_ENGINE_URL)');
    process.exitCode = 1;
    return;
  }

  const dataEngine = createDataEngineClient();
  const ids = await pickCandidateIds(dataEngine);
  if (ids.length === 0) {
    console.error('The data engine returned no candidates');
    process.exitCode = 1;
    return;
  }

  const breederText = process.env.SMOKE_BREEDER_TEXT?.trim() || '';
  console.log(`breeder text: ${breederText || 'none'}`);

  const contexts = await Promise.all(ids.map(async (id) => (await dataEngine.getLlmContext(id)).payload));
  const engineColours = new Map(contexts.map((payload) => [payload.candidate_id, payload.engine_colour ?? payload.colour]));
  const { results, summary, warnings, rejected, usage } = await createClaudeClient().explainAll(contexts, breederText);

  results.forEach((result) => {
    console.log(`\n${result.candidate_id}  engine_colour=${engineColours.get(result.candidate_id)}  `
      + `verified=${result.verified}  justification_source=${result.justification_source}`);
    console.log(`  ${result.justification}`);
  });

  console.log('\nSUMMARY');
  console.log(`  ${summary ?? 'none'}`);

  console.log(`\nWARNINGS (${warnings.length})`);
  warnings.forEach((item) => console.log(`  ${item.code}: ${item.message}`));

  console.log(`\nREJECTED (${rejected.length})`);
  rejected.forEach((item) => {
    console.log(`  ${item.candidate_id}  type=${item.type}  token=${JSON.stringify(item.token)}`);
    console.log(`    claude text: ${item.justification}`);
    item.cited_values.forEach((cited) => {
      console.log(`    cited: field=${JSON.stringify(cited.field)} record=${JSON.stringify(cited.record)} value=${JSON.stringify(cited.value)}`);
    });
  });
  console.log('');
  console.log(`usage: input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens} `
    + `cache_read_tokens=${usage.cache_read_tokens} cache_write_tokens=${usage.cache_write_tokens} `
    + `cost_usd=${usage.cost_usd ?? 'unknown (model not in pricing table)'}`);
}

run().catch((err) => {
  console.error(`FAILED: ${err.code ? `${err.code} ` : ''}${err.message}`);
  process.exitCode = 1;
});
