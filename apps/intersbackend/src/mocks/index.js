import { readFileSync } from 'node:fs';

const cache = new Map();

// Each caller gets its own copy, so a route can never mutate the shared sample.
export function loadSample(name) {
  if (!cache.has(name)) {
    cache.set(name, JSON.parse(readFileSync(new URL(`./${name}.sample.json`, import.meta.url), 'utf8')));
  }
  return structuredClone(cache.get(name));
}
