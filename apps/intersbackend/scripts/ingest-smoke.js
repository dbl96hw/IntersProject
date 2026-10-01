// Live smoke test of the ingest layer: extract a CSV / XLSX and send it to the data engine at DATA_ENGINE_URL.
// Usage: npm run ingest:smoke -w apps/intersbackend -- path/to/file.csv
// Only counts, warning codes, accepted / source / rows / columns sent and candidate ids are printed, never records or file contents.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractTables } from '../src/extractors/tables.js';
import { createDataEngineClient } from '../src/services/dataEngineClient.js';
import { createIngestService } from '../src/services/ingest.service.js';

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run ingest:smoke -w apps/intersbackend -- path/to/file.csv');
    process.exitCode = 1;
    return;
  }

  // npm runs workspace scripts from the workspace folder; resolve against where the command was typed.
  const resolvedPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), filePath);
  const name = path.basename(resolvedPath);
  const buffer = await readFile(resolvedPath);

  const { tables, warnings } = extractTables(name, buffer);
  console.log(`extractTables: ${tables.length} table(s), warnings: ${warnings.map((item) => item.code).join(', ') || 'none'}`);

  const ingestService = createIngestService({ dataEngine: createDataEngineClient() });
  const result = await ingestService.ingestFiles([{ name, buffer }]);

  // A CSV / XLSX file gives one ingestion item per extracted table, in the same order.
  result.ingestion.forEach((item, index) => {
    const columns = tables[index]?.headers.length ?? 'unknown';
    console.log(`table ${index + 1}: accepted=${item.accepted} source=${item.source} rows=${item.rows} columns=${columns}`);
  });
  console.log(`touchedCandidateIds (${result.touchedCandidateIds.length}): ${result.touchedCandidateIds.join(', ') || 'none'}`);
  if (result.warnings.length > 0) {
    console.log(`warnings: ${result.warnings.map((item) => item.code).join(', ')}`);
  }
}

run().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
});
