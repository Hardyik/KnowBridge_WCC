import { config } from '../config.js';
import { HttpError } from '../auth.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const RETRY_DELAYS_MS = [5000, 15000, 30000, 45000];

/** Groq says how long to wait in the 429 body; honour it instead of guessing. */
function retryAfterMs(message: string): number | null {
  const match = message.match(/try again in ([\d.]+)\s*(ms|s)/i);
  if (!match) return null;
  const value = Number(match[1]);
  const ms = match[2].toLowerCase() === 's' ? value * 1000 : value;
  return Math.min(Math.max(Math.ceil(ms) + 250, 500), 60_000);
}

/** A failure that knows whether trying again could help. */
class GroqFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function attempt(system: string, user: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.groqModel,
        temperature: 0,
        max_tokens: 2200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const name = (err as Error).name;
    throw new GroqFailure(name === 'TimeoutError' ? 'request timed out' : (err as Error).message, true);
  }

  if (!response.ok) {
    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    throw new GroqFailure(`Groq ${response.status}: ${body.slice(0, 240)}`, retryable);
  }

  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new GroqFailure('Groq returned an empty completion', true);
  return content;
}

/**
 * One JSON-mode completion from Groq. Rate limits, timeouts and 5xx responses
 * are retried; a missing model or a bad request fails immediately so a
 * configuration mistake does not burn minutes of retries.
 */
export async function completeJson(system: string, user: string): Promise<string> {
  if (!config.groqApiKey) {
    throw new HttpError(503, 'GROQ_API_KEY is not configured on the server');
  }

  let lastError: Error | null = null;
  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    const asked = lastError ? retryAfterMs(lastError.message) : null;
    const delay = index === 0 ? 0 : (asked ?? RETRY_DELAYS_MS[index - 1]);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      return await attempt(system, user);
    } catch (err) {
      if (err instanceof GroqFailure && !err.retryable) {
        throw new HttpError(502, `Extraction model error: ${err.message}`);
      }
      lastError = err as Error;
      console.warn(`Groq attempt ${index + 1} failed: ${lastError.message}`);
    }
  }

  throw new HttpError(502, `Extraction model unavailable: ${lastError?.message ?? 'unknown error'}`);
}
