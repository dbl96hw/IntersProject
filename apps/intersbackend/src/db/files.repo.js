import { TABLES } from '../constants/index.js';
import { toFileRow } from './rows.js';
import { getSupabase, unwrap } from './supabase.js';

const filesTable = () => getSupabase().from(TABLES.FILES);

export async function saveFiles(inputs) {
  if (inputs.length === 0) return [];
  return unwrap(await filesTable().insert(inputs.map(toFileRow)).select());
}

export async function listFilesByChat(chatId) {
  return unwrap(await filesTable().select('*').eq('chat_id', chatId).order('created_at', { ascending: true }));
}

export async function listFilesByMessage(messageId) {
  return unwrap(await filesTable().select('*').eq('message_id', messageId).order('created_at', { ascending: true }));
}
