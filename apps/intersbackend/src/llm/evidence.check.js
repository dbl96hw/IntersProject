// Verifies a Claude justification against the candidate's engine payload (GET /candidates/{id}/llm-context).
// Every number and cited value must already exist in the payload, and the text may not name a colour other
// than the engine's. Anything else is replaced by the engine's own reason: Claude never adds evidence.

import {
  COLOUR_NAMES,
  EVIDENCE_FALLBACK_STATEMENTS,
  JUSTIFICATION_SOURCES,
  REJECTION_TYPES,
  WARNING_CODES,
} from '../constants/index.js';

const TEXT_FIELDS = ['candidate_id', 'verdict', 'reason'];
const LIST_FIELDS = ['evidence', 'trials', 'similar', 'data_gaps'];

// A comma between digits is a decimal mark ("7,7" is 7.7); ids such as SYN-TR-0025 yield 25.
const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

export function normaliseText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// "9.0", "9" and "09" all give "9".
export function normaliseNumber(text) {
  const value = Number(String(text).replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(value) ? String(value) : null;
}

export function extractNumbers(text) {
  return new Set([...String(text).matchAll(NUMBER_PATTERN)].map((match) => normaliseNumber(match[0])));
}

// Labels compare without case, accents or separators: GENOMIC_BREEDING_VALUE, genomic-breeding-value
// and "genomic breeding value" are the same label; SYN-TR-0001 matches syn-tr-0001.
export function normaliseLabel(text) {
  return normaliseText(text).replace(/[\s_-]+/g, ' ').trim();
}

export function evidenceCorpus(payload) {
  const parts = [
    ...TEXT_FIELDS.map((field) => payload[field]),
    ...LIST_FIELDS.flatMap((field) => (Array.isArray(payload[field]) ? payload[field] : [])),
  ].filter((part) => part !== undefined && part !== null && part !== '');
  const text = normaliseText(parts.join(' \n '));
  return { labels: normaliseLabel(text), numbers: extractNumbers(text) };
}

export function labelInCorpus(text, corpus) {
  const label = normaliseLabel(text);
  return label !== '' && corpus.labels.includes(label);
}

export function namedColours(text) {
  const words = normaliseText(text).match(/\p{L}+/gu) ?? [];
  return new Set(words.map((word) => COLOUR_NAMES[word]).filter(Boolean));
}

const rawNumbers = (text) => [...String(text).matchAll(NUMBER_PATTERN)].map((match) => match[0]);
const unknownNumberIn = (text, corpus) => rawNumbers(text).find((raw) => !corpus.numbers.has(normaliseNumber(raw)));

function otherColourIn(text, allowed) {
  return (String(text).match(/\p{L}+/gu) ?? []).find((word) => {
    const colour = COLOUR_NAMES[normaliseText(word)];
    return colour !== undefined && !allowed.has(colour);
  });
}

// Numbers are checked strictly. A field / record label that does not match is not a reason to reject:
// models often rename fields (GENOMIC_BREEDING_VALUE for "genomic breeding value"), while the value is
// what could be invented. A text value that is neither a number nor in the evidence is rejected.
function citedValueProblem(cited, corpus) {
  const numbers = typeof cited.value === 'number' ? [String(cited.value)] : rawNumbers(cited.value);
  if (numbers.length > 0) {
    const unknown = numbers.find((raw) => !corpus.numbers.has(normaliseNumber(raw)));
    return unknown === undefined ? null : unknown;
  }
  return labelInCorpus(cited.value, corpus) ? null : String(cited.value);
}

// Returns { type, token, message } for the first reason the justification cannot be used, or null.
function findProblem(payload, item) {
  const corpus = evidenceCorpus(payload);
  const unknownNumber = unknownNumberIn(item.justification, corpus);
  if (unknownNumber !== undefined) {
    return { type: REJECTION_TYPES.NUMBER, token: unknownNumber, message: `a number (${unknownNumber}) not found in the evidence` };
  }
  for (const cited of item.cited_values ?? []) {
    const token = citedValueProblem(cited, corpus);
    if (token !== null) {
      return { type: REJECTION_TYPES.CITED_VALUE, token, message: `a cited value (${cited.field} = ${token}) not found in the evidence` };
    }
  }
  // After a breeder override, `colour` and `engine_colour` differ; naming either one is accurate.
  const allowed = new Set([payload.colour, payload.engine_colour].filter(Boolean));
  const texts = [item.justification, ...(item.cited_values ?? []).map((cited) => cited.value)];
  const colourWord = texts.map((text) => otherColourIn(text, allowed)).find(Boolean);
  if (colourWord !== undefined) {
    return {
      type: REJECTION_TYPES.COLOUR,
      token: colourWord,
      message: `a colour (${colourWord}) different from the engine's (${payload.colour})`,
    };
  }
  return null;
}

const asSentence = (text) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

// Light stemming so "fails" / "failed" and "trial" / "trials" compare equal.
const stem = (word) => (word.length > 4 && !word.endsWith('ss') ? word.replace(/(ed|es|s)$/, '') : word);

// The words of a statement without its parenthesised detail (trial ids, units, thresholds).
function coreWords(text) {
  const words = normaliseText(text).replace(/\([^)]*\)/g, ' ').match(/[\p{L}\d]+(?:[.,]\d+)?/gu) ?? [];
  return ` ${words.map(stem).join(' ')} `;
}

// A statement adds nothing when its core says the same as the reason or an already chosen statement.
function addsInformation(statement, chosen) {
  const core = coreWords(statement);
  if (core.trim() === '') return false;
  return chosen.every((text) => {
    const other = coreWords(text);
    return !other.includes(core) && !core.includes(other);
  });
}

export function engineJustification(payload) {
  const reason = payload.reason ? [payload.reason] : [];
  const statements = [];
  for (const statement of payload.evidence ?? []) {
    if (statements.length >= EVIDENCE_FALLBACK_STATEMENTS) break;
    if (statement && addsInformation(statement, [...reason, ...statements])) statements.push(statement);
  }
  return [...reason, ...statements].map(asSentence).join(' ');
}

export function engineFallback(payload) {
  return {
    candidate_id: payload.candidate_id,
    justification: engineJustification(payload),
    justification_source: JUSTIFICATION_SOURCES.ENGINE,
    verified: false,
    confidence: null,
    cited_values: [],
  };
}

// `rejection` is internal (logs and smoke tests): it is not part of the API response.
export function checkJustification(payload, item) {
  const problem = findProblem(payload, item);
  if (problem === null) {
    return {
      result: {
        candidate_id: payload.candidate_id,
        justification: item.justification,
        justification_source: JUSTIFICATION_SOURCES.CLAUDE,
        verified: true,
        confidence: item.confidence,
        cited_values: item.cited_values,
      },
      warning: null,
      rejection: null,
    };
  }
  return {
    result: engineFallback(payload),
    warning: {
      code: WARNING_CODES.JUSTIFICATION_UNVERIFIED,
      message: `The justification for ${payload.candidate_id} cited ${problem.message}; the engine's reason is shown instead.`,
      file: null,
    },
    rejection: {
      candidate_id: payload.candidate_id,
      type: problem.type,
      token: problem.token,
      justification: item.justification,
      cited_values: item.cited_values ?? [],
    },
  };
}
