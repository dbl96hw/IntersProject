// Claude tool definitions. The zod schemas are the source of truth: each tool's JSON input_schema
// is generated from them, so what Claude is told and what we validate cannot drift apart.

import { z } from 'zod';
import { CONFIDENCE, ENGINE_SOURCES, LLM_TOOL_NAMES, MAX_JUSTIFICATION_SENTENCES } from '../constants/index.js';

// A sentence ends with . ! or ? followed by a space or the end; "7.7" does not end one.
const countSentences = (text) => text.trim().split(/[.!?]+(?:\s+|$)/).filter((part) => part.trim() !== '').length;

const recordValue = z.union([z.string(), z.number(), z.null()]);

export const recordsInputSchema = z.object({
  tables: z.array(z.object({
    source: z.enum(ENGINE_SOURCES).describe('Engine source the records belong to'),
    records: z.array(z.record(z.string(), recordValue))
      .describe('One object per row, keyed by the original column names of the source; unknown values are null'),
  })),
  warnings: z.array(z.string()).describe('Anything that could not be read or mapped'),
});

export const justificationsInputSchema = z.object({
  items: z.array(z.object({
    candidate_id: z.string().min(1),
    justification: z.string().min(1)
      .refine((text) => countSentences(text) <= MAX_JUSTIFICATION_SENTENCES, {
        message: `must be 1-${MAX_JUSTIFICATION_SENTENCES} sentences`,
      })
      .describe(`1-${MAX_JUSTIFICATION_SENTENCES} sentences citing only the candidate's evidence`),
    cited_values: z.array(z.object({
      field: z.string().min(1),
      record: z.string().min(1),
      value: z.union([z.string(), z.number()]),
    })).describe('Every value mentioned in the justification, as it appears in the evidence'),
    confidence: z.enum(Object.values(CONFIDENCE)),
  })),
  summary: z.string().describe('One or two sentences about the whole batch'),
  warnings: z.array(z.string()),
});

function toInputSchema(schema) {
  const inputSchema = z.toJSONSchema(schema);
  delete inputSchema.$schema;
  return inputSchema;
}

function defineTool(name, description, schema) {
  return { definition: { name, description, input_schema: toInputSchema(schema) }, schema };
}

export const TOOLS = {
  [LLM_TOOL_NAMES.SUBMIT_RECORDS]: defineTool(
    LLM_TOOL_NAMES.SUBMIT_RECORDS,
    'Submit the records extracted from the document, grouped by engine source.',
    recordsInputSchema,
  ),
  [LLM_TOOL_NAMES.SUBMIT_JUSTIFICATIONS]: defineTool(
    LLM_TOOL_NAMES.SUBMIT_JUSTIFICATIONS,
    'Submit one justification per candidate, citing only values from its candidate_context.',
    justificationsInputSchema,
  ),
};
