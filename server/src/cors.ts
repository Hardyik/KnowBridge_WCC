import type { CorsOptions } from 'cors';

/** Loopback origins stay allowed so local dev and previews keep working. */
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Vercel mints a new origin for every deployment (knowbridge-<hash>-<team>.vercel.app),
 * so a single pinned CORS_ORIGIN breaks again on the next deploy. Accept this project's
 * own Vercel origins automatically; anything else must be listed in CORS_ORIGIN.
 */
const PROJECT_VERCEL_ORIGIN = /^https:\/\/knowbridge[a-z0-9-]*\.vercel\.app$/;

export function corsOptions(rawOrigins: string): CorsOptions {
  const configured = rawOrigins
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const isAllowed = (origin: string): boolean =>
    configured.includes(origin) || LOOPBACK_ORIGIN.test(origin) || PROJECT_VERCEL_ORIGIN.test(origin);

  return {
    origin(origin, callback) {
      // No Origin header: same-origin requests, curl and server-to-server calls.
      if (!origin) return callback(null, true);
      callback(null, isAllowed(origin));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  };
}
