/**
 * The one place that decides what a recipient may see.
 *
 * Two layers apply together: the member's section scope and each claim's
 * confidentiality tier. A delivery link and the assistant call this too, so a
 * restriction cannot be bypassed by choosing a different surface.
 */

import {
  Confidentiality,
  HandoverSection,
  RecipientScope,
  SECTIONS_BY_SCOPE,
  tierVisibleToScope,
} from '@knowbridge/shared';
import { serviceClient, Tables } from '../db.js';

export function tierOf(claim: { confidentiality?: Confidentiality | null }): Confidentiality {
  return claim.confidentiality ?? 'internal';
}

/**
 * A snapshot records the tier a claim had when it was approved, but a
 * restriction added later must still take effect: otherwise marking a source
 * restricted would leave it readable through every earlier approval. The
 * source's current tier therefore overrides the frozen copy, and only ever
 * makes a claim stricter, never more visible.
 */
export async function withCurrentTiers(sections: HandoverSection[]): Promise<HandoverSection[]> {
  const sourceIds = [
    ...new Set(sections.flatMap((section) => section.claims.map((claim) => claim.evidence.source_id))),
  ];
  if (!sourceIds.length) return sections;

  const { data } = await serviceClient()
    .from(Tables.sources)
    .select('id, confidentiality')
    .in('id', sourceIds);
  const current = new Map((data ?? []).map((row) => [row.id as string, row.confidentiality as Confidentiality]));

  return sections.map((section) => ({
    ...section,
    claims: section.claims.map((claim) => ({
      ...claim,
      confidentiality: current.get(claim.evidence.source_id) ?? tierOf(claim),
    })),
  }));
}

export function claimVisible(
  claim: { review_state: string; confidentiality?: Confidentiality | null },
  scope: RecipientScope,
): boolean {
  if (claim.review_state === 'redacted') return false;
  return tierVisibleToScope(tierOf(claim), scope);
}

export function scopedSections(
  sections: HandoverSection[],
  scope: RecipientScope,
): { sections: HandoverSection[]; hidden_claim_count: number } {
  const allowed = new Set(SECTIONS_BY_SCOPE[scope]);
  const visible = sections
    .filter((section) => allowed.has(section.key))
    .map((section) => ({
      ...section,
      claims: section.claims.filter((claim) => claimVisible(claim, scope)),
    }));

  const total = sections.reduce((sum, section) => sum + section.claims.length, 0);
  const shown = visible.reduce((sum, section) => sum + section.claims.length, 0);
  return { sections: visible, hidden_claim_count: total - shown };
}
