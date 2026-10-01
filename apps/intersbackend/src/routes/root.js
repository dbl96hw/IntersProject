import { Router } from 'express';
import { ROOT_PATH } from '../constants/index.js';

export function createRootRouter() {
  const router = Router();

  router.get(ROOT_PATH, (req, res) => {
    res.json({
      status: 'ok',
      service: 'intersbackend',
      env: process.env.NODE_ENV || 'development',
    });
  });

  return router;
}
