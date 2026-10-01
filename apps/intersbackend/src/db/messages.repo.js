import { TABLES } from '../constants/index.js';
import { touchChat } from './chats.repo.js';
import { toMessagePatch, toMessageRow } from './rows.js';
import { getSupabase, unwrap } from './supabase.js';

const messagesTable = () => getSupabase().from(TABLES.MESSAGES);

export async function saveMessage(input) {
  const message = unwrap(await messagesTable().insert(toMessageRow(input)).select().single());
  await touchChat(message.chat_id);
  return message;
}

export async function getMessage(id) {
  return unwrap(await messagesTable().select('*').eq('id', id).maybeSingle());
}

export async function listMessages(chatId) {
  return unwrap(await messagesTable().select('*').eq('chat_id', chatId).order('created_at', { ascending: true }));
}

export async function updateMessage(id, patch) {
  return unwrap(await messagesTable().update(toMessagePatch(patch)).eq('id', id).select().single());
}
