import dotenv from 'dotenv';
import { z } from 'zod';

// .env is authoritative locally; without override an inherited PORT (often 0)
// would silently win and the server would bind a random port.
dotenv.config({ override: true });

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  GROQ_API_KEY: z.string().min(10).optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Invalid server environment (${missing}). Copy server/.env.example to server/.env.`);
}

export const config = {
  supabaseUrl: parsed.data.SUPABASE_URL,
  supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
  supabaseServiceKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  groqApiKey: parsed.data.GROQ_API_KEY,
  groqModel: parsed.data.GROQ_MODEL,
  port: parsed.data.PORT > 0 ? parsed.data.PORT : 4000,
  corsOrigin: parsed.data.CORS_ORIGIN,
  groqConfigured: Boolean(parsed.data.GROQ_API_KEY),
};
