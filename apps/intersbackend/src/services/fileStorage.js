import { getSupabase } from '../db/supabase.js';

// The name comes from the client: keep the storage key to a safe charset. The files row keeps the original name.
export function toStoragePath(chatId, messageId, index, name) {
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${chatId}/${messageId}/${index}-${safeName}`;
}

export function createMemoryFileStorage() {
  const buffers = new Map();
  return {
    async save(storagePath, buffer) {
      buffers.set(storagePath, Buffer.from(buffer));
    },
    async read(storagePath) {
      return buffers.get(storagePath) ?? null;
    },
  };
}

export function createSupabaseFileStorage(bucket) {
  const storage = () => getSupabase().storage.from(bucket);
  return {
    async save(storagePath, buffer, mimeType) {
      const { error } = await storage().upload(storagePath, buffer, { contentType: mimeType, upsert: false });
      if (error) throw new Error(`Supabase Storage: ${error.message}`);
    },
    async read(storagePath) {
      const { data, error } = await storage().download(storagePath);
      if (error) throw new Error(`Supabase Storage: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    },
  };
}
