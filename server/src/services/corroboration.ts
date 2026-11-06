/**
 * Cross-source corroboration.
 *
 * The point of a second source type is that the same fact can be stated twice:
 * a decision in a handover note and the commit that implemented it, or a
 * pending item in a runbook and an open issue. We detect that deterministically
 * and show both pieces of evidence instead of merging them.
 */

import { Claim } from '@knowbridge/shared';
import { similarText } from './similarity.js';

const THRESHOLD = 0.5;
const MIN_LENGTH = 40;
const MAX_CLAIMS = 500;

export function attachCorroborations(claims: Claim[]): Claim[] {
  if (claims.length > MAX_CLAIMS) return claims;

  return claims.map((claim, index) => {
    if (claim.text.length < MIN_LENGTH) return claim;

    const matches = claims.filter(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.evidence.source_id !== claim.evidence.source_id &&
        other.source_kind !== claim.source_kind &&
        other.review_state !== 'excluded' &&
        other.text.length >= MIN_LENGTH &&
        similarText(claim.text, other.text) >= THRESHOLD,
    );

    if (!matches.length) return claim;
    return {
      ...claim,
      corroborations: matches.slice(0, 3).map((match) => ({
        claim_id: match.id,
        source_title: match.evidence.source_title,
        source_kind: match.source_kind,
      })),
    };
  });
}
