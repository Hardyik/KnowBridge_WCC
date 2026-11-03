import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from './config.js';

// Node < 22 has no global WebSocket and supabase-js builds its Realtime client
// eagerly, so any query would throw without this shim.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
}

export const Tables = {
  profiles: 'profiles',
  projects: 'projects',
  projectMembers: 'project_members',
  sources: 'sources',
  sourceChunks: 'source_chunks',
  claims: 'claims',
  handovers: 'handovers',
  acknowledgements: 'acknowledgements',
  auditLog: 'audit_log',
} as const;

let service: SupabaseClient | null = null;
let anonymous: SupabaseClient | null = null;

/**
 * Service-role client. Every route performs its own permission check first;
 * RLS is the second line of defence, not the first.
 */
export function serviceClient(): SupabaseClient {
  if (!service) {
    service = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return service;
}

/** Anonymous client, only used to exchange a password for a session. */
export function anonClient(): SupabaseClient {
  if (!anonymous) {
    anonymous = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return anonymous;
}
