import express from 'express';
import { HEALTH_PATH } from './constants/index.js';

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'intersbackend',
    env: process.env.NODE_ENV || 'development',
  });
});

app.get(HEALTH_PATH, (req, res) => {
  res.json({ healthy: true });
});

app.listen(port, () => {
  console.log(`intersbackend listening on port ${port}`);
});
