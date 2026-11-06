/**
 * Deterministic text comparison shared by review-preserving re-extraction and
 * cross-source corroboration. No model is involved: the same statement should
 * fingerprint the same way on every run.
 */

import { createHash } from 'node:crypto';
import { normalise } from './documents.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'have', 'has', 'was', 'were',
  'are', 'not', 'but', 'its', 'their', 'they', 'will', 'been', 'being', 'which', 'when',
  'than', 'then', 'also', 'only', 'still', 'yet', 'all', 'any', 'can', 'may', 'must',
  'had', 'our', 'your', 'over', 'under', 'after', 'before', 'used', 'using', 'via',
  'there', 'these', 'those', 'each', 'more', 'most', 'some', 'such', 'does', 'did',
]);

/** Stable identity for a statement: whitespace and case insensitive. */
export function fingerprint(text: string): string {
  return createHash('sha1').update(normalise(text)).digest('hex').slice(0, 20);
}

export function subjectTokens(text: string): Set<string> {
  return new Set(
    normalise(text)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  );
}

/** Share of the smaller token set that both statements use. */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

export function similarText(a: string, b: string): number {
  return overlap(subjectTokens(a), subjectTokens(b));
}
