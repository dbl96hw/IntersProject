import { createApp } from './app.js';
import { config } from './config/env.js';

createApp().listen(config.port, () => {
  console.log(`intersbackend listening on port ${config.port} (mode: ${config.analysisMode})`);
});
