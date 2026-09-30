// Example Express router exposing the data engine to the frontend (copy into apps/intersbackend/src/routes/).
//
//   import { breederRouter } from './routes/breederRoutes.js';
//   app.use(express.json({ limit: '25mb' }));      // documents arrive as base64
//   app.use('/api/breeder', breederRouter);
//
// Routes stay thin (validate -> forward -> return JSON) and keep the team's error shape.

import express from 'express';
import { askBreedersDesk } from './agentLoop.example.js';
import { createDataEngineClient, DataEngineError } from './dataEngineClient.js';

const engine = createDataEngineClient();
export const breederRouter = express.Router();

function sendError(res, err) {
  if (err instanceof DataEngineError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, field: err.field } });
    return;
  }
  console.error('breeder route failed:', err.message);
  res.status(502).json({ error: { code: 'DATA_ENGINE_UNAVAILABLE', message: 'Data engine is not reachable' } });
}

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    sendError(res, err);
  }
};

breederRouter.get('/candidates', handle((req) => engine.listCandidates(req.query)));
breederRouter.get('/candidates/:id', handle((req) => engine.getCandidate(req.params.id)));
breederRouter.get('/trials/:id', handle((req) => engine.getTrial(req.params.id)));
breederRouter.get('/search', handle((req) => engine.search(req.query.q || '')));
breederRouter.get('/override-reasons', handle(() => engine.listOverrideReasons()));
breederRouter.get('/baseline', handle(() => engine.baseline()));
breederRouter.get('/quality', handle(() => engine.quality()));

breederRouter.post('/overrides', async (req, res) => {
  try {
    res.status(201).json(await engine.createOverride(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

breederRouter.post('/documents', handle((req) => {
  const { filename, contentBase64 } = req.body || {};
  return engine.uploadDocument(filename, Buffer.from(contentBase64 || '', 'base64'));
}));

breederRouter.post('/chat', async (req, res) => {
  const question = (req.body?.question || '').trim();
  if (!question) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'question is required', field: 'question' } });
    return;
  }
  try {
    res.json(await askBreedersDesk(question, req.body?.history || []));
  } catch (err) {
    sendError(res, err);
  }
});
