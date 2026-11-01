import 'dotenv/config'; // loaded only if present: node --import tsx handles .env via dotenv in scripts

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  supabaseUrl: required('SUPABASE_URL', ''),
  supabaseAnonKey: required('SUPABASE_ANON_KEY', ''),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY', ''),
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  groqModel: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
};

/** True when Supabase credentials are configured. */
export function serverConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceKey);
}
