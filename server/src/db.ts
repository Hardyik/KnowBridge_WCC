import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

/**
 * Service-role client. Parametrised functions in the *route layer* enforce
 * permission checks before any call, and RLS is the second line of defence
 * for anything routed through clients. This client bypasses RLS, so it is
 * never returned to or used outside this process.
 */
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (!cached) importSupabase();
  return cached!;
}

function importSupabase() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Supabase env vars missing — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  cached = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Tables / column names used with the service client. */
export const Tables = {
  profiles: 'profiles',
  projects: 'projects',
  projectMembers: 'project_members',
  sources: 'sources',
  sourcePieces: 'source_pieces',
  claims: 'claims',
  claimEvidence: 'claim_evidence',
  handovers: 'handovers',
  acknowledgements: 'acknowledgements',
  auditLog: 'audit_log',
} as const;
