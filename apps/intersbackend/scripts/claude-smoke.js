// Live smoke test of the explanation path: fetch the llm-context of 5 candidates from the data engine
// at DATA_ENGINE_URL, run explainAll with the real Claude API and print what came back.
// Usage (engine running, ANALYSIS_MODE=live): npm run claude:smoke -w apps/intersbackend
// Prints ids, verification, sources, justifications, full warnings, rejected Claude texts (with the offending
// token) and usage; never the API key or engine payloads.

import { config } from '../src/config/env.js';
import { ANALYSIS_MODES } from '../src/constants/index.js';
import { createClaudeClient } from '../src/llm/claude.client.js';
import { createDataEngineClient } from '../src/services/dataEngineClient.js';

const SMOKE_CANDIDATES = 5;

async function run() {
  if (config.analysisMode !== ANALYSIS_MODES.LIVE) {
    console.error('claude:smoke needs ANALYSIS_MODE=live (and the data engine running at DATA_ENGINE_URL)');
    process.exitCode = 1;
    return;
  }

  const dataEngine = createDataEngineClient();
  const candidates = await dataEngine.listCandidates({ limit: SMOKE_CANDIDATES });
  const ids = candidates.map((candidate) => candidate.candidate_id);
  if (ids.length === 0) {
    console.error('The data engine returned no candidates');
    process.exitCode = 1;
    return;
  }

  const contexts = await Promise.all(ids.map(async (id) => (await dataEngine.getLlmContext(id)).payload));
  const { results, warnings, rejected, usage } = await createClaudeClient().explainAll(contexts);

  results.forEach((result) => {
    console.log(`\n${result.candidate_id}  verified=${result.verified}  justification_source=${result.justification_source}`);
    console.log(`  ${result.justification}`);
  });

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
