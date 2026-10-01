import { Router } from 'express';
import { API_PATHS } from '../constants/index.js';
import { asyncHandler } from './helpers.js';

export function createEngineRouter({ engineService }) {
  const router = Router();

  router.get(API_PATHS.ENGINE_OVERRIDE_REASONS, asyncHandler(async (req, res) => {
    res.json(await engineService.overrideReasons());
  }));

  router.get(API_PATHS.ENGINE_BASELINE, asyncHandler(async (req, res) => {
    res.json(await engineService.baseline());
  }));

  router.get(API_PATHS.ENGINE_QUALITY, asyncHandler(async (req, res) => {
    res.json(await engineService.quality());
  }));

  return router;
}
