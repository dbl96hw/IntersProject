import { config } from '../config/env.js';
import { ANALYSIS_MODES } from '../constants/index.js';
import * as candidates from './candidates.repo.js';
import * as chats from './chats.repo.js';
import * as files from './files.repo.js';
import { createMemoryDb } from './memory.js';
import * as messages from './messages.repo.js';

const supabaseDb = { chats, messages, files, candidates };

export const db = config.analysisMode === ANALYSIS_MODES.LIVE ? supabaseDb : createMemoryDb();
