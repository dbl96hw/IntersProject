import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkJustification, evidenceCorpus, labelInCorpus, normaliseNumber } from '../src/llm/evidence.check.js';

// Shape of GET /candidates/{id}/llm-context -> payload.
const PAYLOAD = {
  candidate_id: 'SYN-MZ-00001',
  colour: 'RED',
  engine_colour: 'RED',
  verdict: 'FAIL',
  reason: 'fails in 3 of 5 trials',
  rule_version: 'UC4_MATERIAL_V0',
  evidence: [
    'disease risk elevated (DISEASE_SCORE = 7.7 score (1-9), threshold <= 5)',
    'yield below target (YIELD_T_HA = 9.0 t/ha, threshold >= 9.5)',
    'plant height normal (PLANT_HEIGHT_CM = 210 cm)',
  ],
  trials: ['SYN-TR-0001 LOC-01 2024: FAIL', 'SYN-TR-0025 LOC-03 2025: PASS (ambiguous)'],
  atypical: false,
  similar: ['SYN-MZ-00042'],
  document_mentions: ['lab-report.pdf p.3: yield reached 12.5 t/ha'],
  data_gaps: ['no genomics record for 2023'],
  instructions: 'Cite only these values. Never compute new numbers. The breeder decides.',
};

const ENGINE_TEXT = 'fails in 3 of 5 trials. '
  + 'disease risk elevated (DISEASE_SCORE = 7.7 score (1-9), threshold <= 5). '
  + 'yield below target (YIELD_T_HA = 9.0 t/ha, threshold >= 9.5).';

const item = (justification, citedValues = []) => ({
  candidate_id: PAYLOAD.candidate_id,
  justification,
  cited_values: citedValues,
  confidence: 'high',
});

function assertEngineFallback(checked) {
  assert.equal(checked.result.verified, false);
  assert.equal(checked.result.justification_source, 'engine');
  assert.equal(checked.result.justification, ENGINE_TEXT);
  assert.equal(checked.result.confidence, null);
  assert.equal(checked.warning.code, 'JUSTIFICATION_UNVERIFIED');
}

test('normaliseNumber treats 9.0 / 9 and 7,7 / 7.7 as equal', () => {
  assert.equal(normaliseNumber('9.0'), normaliseNumber('9'));
  assert.equal(normaliseNumber('7,7'), normaliseNumber('7.7'));
  assert.equal(normaliseNumber('0025'), '25');
});

test('a justification backed by the evidence passes, across number formats', () => {
  const checked = checkJustification(PAYLOAD, item(
    'Fails in 3 of 5 trials: DISEASE_SCORE is 7,7 against a threshold of 5, and yield is 9 t/ha in SYN-TR-0001, close to SYN-MZ-00042.',
    [
      { field: 'disease_score', record: 'SYN-TR-0001', value: 7.7 },
      { field: 'YIELD_T_HA', record: 'SYN-TR-0001', value: '9' },
    ],
  ));
  assert.equal(checked.warning, null);
  assert.equal(checked.result.verified, true);
  assert.equal(checked.result.justification_source, 'claude');
  assert.equal(checked.result.confidence, 'high');
});

test('the engine fallback skips evidence statements that only repeat the reason', () => {
  const payload = {
    ...PAYLOAD,
    evidence: [
      'failed in 3 of 5 trials (SYN-TR-0001, SYN-TR-0007, SYN-TR-0013, SYN-TR-0019, SYN-TR-0025)',
      'genomic breeding value 96.7 (< 102)',
      'Genomic breeding value 96.7 (< 102).',
      'disease risk elevated (DISEASE_SCORE = 7.7 score (1-9), threshold <= 5)',
      'plant height normal (PLANT_HEIGHT_CM = 210 cm)',
    ],
  };
  const checked = checkJustification(payload, item('Yield of 11.2 t/ha.'));
  assert.equal(
    checked.result.justification,
    'fails in 3 of 5 trials. genomic breeding value 96.7 (< 102). '
      + 'disease risk elevated (DISEASE_SCORE = 7.7 score (1-9), threshold <= 5).',
  );
});

test('the engine fallback is the reason alone when every statement repeats it', () => {
  const payload = { ...PAYLOAD, evidence: ['failed in 3 of 5 trials (SYN-TR-0001, SYN-TR-0007)'] };
  assert.equal(checkJustification(payload, item('Yield of 11.2 t/ha.')).result.justification, 'fails in 3 of 5 trials.');
});

test('a justification with an invented number falls back to the engine reason', () => {
  const checked = checkJustification(PAYLOAD, item('Fails in 3 of 5 trials with a yield of 11,2 t/ha.'));
  assertEngineFallback(checked);
  assert.equal(checked.rejection.type, 'number');
  assert.equal(checked.rejection.token, '11,2');
  assert.equal(checked.rejection.justification, 'Fails in 3 of 5 trials with a yield of 11,2 t/ha.');
});

test('numbers outside the evidence fields (document_mentions) are not accepted', () => {
  assertEngineFallback(checkJustification(PAYLOAD, item('A lab report shows yield reached 12.5 t/ha.')));
});

test('a cited value that is not in the evidence is rejected, with the offending value as token', () => {
  const cited = [{ field: 'DISEASE_SCORE', record: 'SYN-TR-0001', value: 6.1 }];
  const checked = checkJustification(PAYLOAD, item('Disease risk is elevated.', cited));
  assertEngineFallback(checked);
  assert.deepEqual(checked.rejection, {
    candidate_id: 'SYN-MZ-00001',
    type: 'cited_value',
    token: '6.1',
    justification: 'Disease risk is elevated.',
    cited_values: cited,
  });
  assert.match(checked.warning.message, /DISEASE_SCORE = 6\.1/);

  const textValue = checkJustification(PAYLOAD, item('Disease risk is elevated.', [{ field: 'NOTE', record: 'x', value: 'resistant to drought' }]));
  assert.equal(textValue.rejection.type, 'cited_value');
  assert.equal(textValue.rejection.token, 'resistant to drought');
});

test('field and record labels match without case or separators', () => {
  const corpus = evidenceCorpus({ ...PAYLOAD, evidence: ['genomic breeding value 96.7 (< 102)'] });
  for (const label of ['GENOMIC_BREEDING_VALUE', 'genomic-breeding-value', 'genomic breeding value', 'Genomic  Breeding_Value']) {
    assert.equal(labelInCorpus(label, corpus), true, label);
  }
  assert.equal(labelInCorpus('syn-tr-0001', corpus), true);
  assert.equal(labelInCorpus('SYN_TR_0001', corpus), true);
  assert.equal(labelInCorpus('MOISTURE_PCT', corpus), false);
});

test('a renamed field or unknown record does not reject when the value is in the evidence', () => {
  const payload = { ...PAYLOAD, evidence: ['genomic breeding value 96.7 (< 102)', ...PAYLOAD.evidence] };
  const checked = checkJustification(payload, item('Genomic breeding value is 96.7, below 102.', [
    { field: 'GENOMIC_BREEDING_VALUE', record: 'syn-mz-00001', value: 96.7 },
    { field: 'genomic-breeding-value', record: 'genomics', value: '96.7' },
    { field: 'TOTALLY_UNKNOWN', record: 'SYN-TR-9999', value: 102 },
  ]));
  assert.equal(checked.result.verified, true);
  assert.equal(checked.rejection, null);
});

test('numbers stay strict even when the field and record match', () => {
  const checked = checkJustification(PAYLOAD, item('Disease risk is elevated.', [{ field: 'DISEASE_SCORE', record: 'SYN-TR-0001', value: '7.8' }]));
  assertEngineFallback(checked);
  assert.equal(checked.rejection.token, '7.8');
});

test('a justification naming a different colour is rejected', () => {
  const checked = checkJustification(PAYLOAD, item('This line looks AMBER: it fails in 3 of 5 trials.'));
  assertEngineFallback(checked);
  assert.match(checked.warning.message, /AMBER/);
  assert.equal(checked.rejection.type, 'colour');
  assert.equal(checked.rejection.token, 'AMBER');
});

test('a Spanish justification naming the wrong colour is rejected, with or without accents', () => {
  const accented = checkJustification(PAYLOAD, item('La línea queda en ámbar: falla en 3 de 5 ensayos.'));
  assertEngineFallback(accented);
  assert.equal(accented.rejection.token, 'ámbar');
  assertEngineFallback(checkJustification(PAYLOAD, item('La linea queda en ambar: falla en 3 de 5 ensayos.')));
  assertEngineFallback(checkJustification(PAYLOAD, item('Las señales son verdes en 3 de 5 ensayos.')));
});

test('a Spanish justification naming the engine colour passes', () => {
  const checked = checkJustification(PAYLOAD, item('La línea está en rojo: falla en 3 de 5 ensayos y DISEASE_SCORE = 7,7.'));
  assert.equal(checked.result.verified, true);
  assert.equal(checked.result.justification_source, 'claude');
});

test('after an override, naming either the effective or the engine colour passes', () => {
  const overridden = { ...PAYLOAD, colour: 'AMBER', engine_colour: 'RED' };
  assert.equal(checkJustification(overridden, item('The engine suggested RED; the breeder set AMBER.')).result.verified, true);
  assert.equal(checkJustification(overridden, item('This line is GREEN.')).result.verified, false);
});
