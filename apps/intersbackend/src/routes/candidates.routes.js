import { Router } from 'express';
import { z } from 'zod';
import {
  API_PATHS,
  COLOURS,
  DECISIONS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from '../constants/index.js';
import { asyncHandler, requireUuid } from './helpers.js';

const OTHER_REASON_CODE = 'OTHER';
const colourSchema = (field) => z.enum(Object.values(COLOURS), { error: `${field} must be GREEN, AMBER or RED` });
const requiredString = (field) => z.string({ error: `${field} is required` }).trim().min(1, `${field} is required`);

const listQuerySchema = z.object({
  colour: colourSchema('colour').optional(),
  decision: z.enum(Object.values(DECISIONS), { error: 'decision must be pending, pass or no_pass' }).optional(),
  q: z.string().max(MAX_SEARCH_LENGTH).optional(),
  chat_id: z.uuid('chat_id must be a uuid').optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

const updateSchema = z.object({
  new_colour: colourSchema('new_colour').optional(),
  justification: z.string().trim().min(1, 'justification must not be empty').optional(),
  reason_code: requiredString('reason_code'),
  comment: z.string({ error: 'comment is required (may be "")' }),
  user: requiredString('user'),
})
  .refine((body) => body.new_colour || body.justification, {
    message: 'new_colour or justification is required',
    path: ['new_colour'],
  })
  .refine((body) => body.reason_code !== OTHER_REASON_CODE || body.comment.trim() !== '', {
    message: 'comment is required when reason_code is OTHER',
    path: ['comment'],
  });

const decisionSchema = z.object({
  decision: z.enum([DECISIONS.PASS, DECISIONS.NO_PASS], { error: 'decision must be pass or no_pass' }),
  reason_code: z.string().trim().min(1).optional(),
  comment: z.string().optional(),
  user: requiredString('user'),
});

export function createCandidatesRouter({ candidatesService }) {
  const router = Router();

  router.get(API_PATHS.CANDIDATES, asyncHandler(async (req, res) => {
    const filters = listQuerySchema.parse(req.query);
    res.json(await candidatesService.listCandidates(filters));
  }));

  router.get(API_PATHS.CANDIDATE, asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Candidate');
    res.json(await candidatesService.getCandidateDetail(id));
  }));

  // Ticket 3: forward colour changes to the engine's POST /overrides and append a candidate review.
  // Mock mode still answers 501 after validation. The service enforces that.
  router.patch(API_PATHS.CANDIDATE, asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Candidate');
    const body = updateSchema.parse(req.body ?? {});
    res.json(await candidatesService.updateCandidate(id, body));
  }));

  // Ticket 3: store the breeder's pass / no pass as a candidate review.
  router.post(API_PATHS.CANDIDATE_DECISION, asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Candidate');
    const body = decisionSchema.parse(req.body ?? {});
    res.json(await candidatesService.recordDecision(id, body));
  }));

  return router;
}
