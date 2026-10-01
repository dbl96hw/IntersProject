import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

let client;

// Created lazily so mock mode (no Supabase variables) never builds a client.
export function getSupabase() {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function unwrap({ data, error }) {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}
