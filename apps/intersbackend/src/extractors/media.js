import path from 'node:path';
import { MEDIA_TYPES } from '../constants/index.js';

// PDF and images go to Claude as base64 content blocks.
export function toMedia(name, buffer) {
  const mediaType = MEDIA_TYPES[path.extname(name).toLowerCase()];
  if (!mediaType) throw new Error(`"${name}" is not a PDF or a supported image`);
  return { media_type: mediaType, data: Buffer.from(buffer).toString('base64') };
}
