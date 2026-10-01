// Live smoke test of the Supabase data layer: create a chat, save a message, read both back, then delete the chat.
// Usage: npm run db:smoke -w apps/intersbackend (loads apps/intersbackend/.env).
// Only names and ids are printed, never keys or URLs.

// Must be set before config/env.js is imported, so the imports below are dynamic.
process.env.ANALYSIS_MODE = 'live';

const SMOKE_TITLE = 'db-smoke';

async function run() {
  const { db } = await import('../src/db/index.js');
  const { getSupabase, unwrap } = await import('../src/db/supabase.js');
  const { TABLES } = await import('../src/constants/index.js');

  let chatId;
  try {
    const chat = await db.chats.createChat({ title: SMOKE_TITLE });
    chatId = chat.id;

    const saved = await db.messages.saveMessage({ chat_id: chat.id, role: 'user', kind: 'text', text: 'smoke test' });
    const readChat = await db.chats.getChat(chat.id);
    const messages = await db.messages.listMessages(chat.id);

    if (readChat?.title !== SMOKE_TITLE) throw new Error('chat was not read back');
    if (messages.length !== 1 || messages[0].id !== saved.id || messages[0].text !== 'smoke test') {
      throw new Error('message was not read back');
    }

    console.log(`OK: chat ${chat.id} and message ${saved.id} written and read back`);
  } finally {
    // Deleting the chat cascades to its messages.
    if (chatId) {
      unwrap(await getSupabase().from(TABLES.CHATS).delete().eq('id', chatId));
      console.log(`Cleaned up chat ${chatId}`);
    }
  }
}

run().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
});
