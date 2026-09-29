import express from 'express';

const app = express();
const port = process.env.PORT || 3000;
const frontendOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', frontendOrigin);
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'intersbackend',
    env: process.env.NODE_ENV || 'development',
  });
});

app.get('/health', (req, res) => {
  res.json({ healthy: true });
});

app.listen(port, () => {
  console.log(`intersbackend listening on port ${port}`);
});
