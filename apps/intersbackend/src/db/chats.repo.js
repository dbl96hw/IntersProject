import { TABLES } from '../constants/index.js';
import { toChatRow } from './rows.js';
import { getSupabase, unwrap } from './supabase.js';

const chatsTable = () => getSupabase().from(TABLES.CHATS);

export async function createChat(input) {
  return unwrap(await chatsTable().insert(toChatRow(input)).select().single());
}

export async function listChats() {
  return unwrap(await chatsTable().select('*').order('updated_at', { ascending: false }));
}

export async function getChat(id) {
  return unwrap(await chatsTable().select('*').eq('id', id).maybeSingle());
}

export async function updateChatTitle(id, title) {
  return unwrap(await chatsTable()
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle());
}

export async function touchChat(id) {
  unwrap(await chatsTable().update({ updated_at: new Date().toISOString() }).eq('id', id));
}
