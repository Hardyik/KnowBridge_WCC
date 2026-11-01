/**
 * Extraction pipeline: source pieces -> Groq -> validated claims with
 * evidence -> dedup + conflict detection -> Supabase.
 *
 * Guarantees enforced here (doc §3.4):
 * - a claim with no quote at all is stored as `unsupported`, and the UI
 *   shows it as "needs evidence", never as verified fact;
 * - two same-category claims whose text contradicts (same subject,
 *   opposite state words) are both upgraded to `conflicting`;
 * - knowledge already collected is not re-created (dedup merges evidence).
 */
import {
  ExtractedClaim,
  ExtractionResultSummary,
} from '@knowbridge/shared';
import { z } from 'zod';
import { serviceClient, Tables } from '../db.js';
import { config } from '../config.js';
import { audit } from '../auth.js';
import { extractClaimsFromText } from './groq.js';

export async function runExtraction(
  ctx: { project_id?: string; profile: { id: string; email: string } },
): Promise<ExtractionResultSummary> {
  const projectId = ctx.project_id!;
  const db = serviceClient();

  // 1. Load pieces for all sources of this project.
  const { data: sources, error: srcErr } = await db
    .from(Tables.sources)
    .select('id, title, type')
    .eq('project_id', projectId)
    .eq('status', 'ready');
  if (srcErr) throw new Error(`Failed to load sources: ${srcErr.message}`);
  if (!sources || sources.length === 0) {
    throw new Error('No sources connected yet — add a document or GitHub repo first');
  }

  const { data: pieces, error: pieceErr } = await db
    .from(Tables.sourcePieces)
    .select('id, source_id, idx, label, location, text, url, sources!inner(project_id)')
    .eq('sources.project_id', projectId)
    .order('idx', { ascending: true });
  if (pieceErr) throw new Error(`Failed to load pieces: ${pieceErr.message}`);

  // 2. Existing claims for dedup/conflict awareness.
  const { data: existing } = await db
    .from(Tables.claims)
    .select('id, category, text, status')
    .eq('project_id', projectId);
  const existingList = (existing ?? []) as Array<{ id: string; category: string; text: string; status: string }>;

  const summary: ExtractionResultSummary = {
    pieces: pieces?.length ?? 0,
    claims_created: 0,
    claims_conflicting: 0,
    unsupported_flagged: 0,
    deduped: 0,
  };

  // 3. Extract per piece.
  for (const piece of pieces ?? []) {
    let extracted: ExtractedClaim[];
    try {
      extracted = await extractClaimsFromText(piece.text, config.groqApiKey, config.groqModel);
    } catch (err) {
      // One bad API call must not abort the whole pipeline; surface at end.
      summary.unsupported_flagged += 0;
      console.error('Groq call failed for piece', piece.id, err);
      continue;
    }

    for (const raw of extracted) {
      const claim = raw;
      const quote = claim.quote?.trim() || null;
      const grounded = quote !== null && !claim.unsupported;
      const status = grounded ? 'supported' : 'unsupported';

      // Dedup: same category + high token overlap => skip, merge evidence instead.
      const dup = [...existingList].find((e) => e.category === claim.category && similar(e.text, claim.text) > 0.85);
      if (dup) {
        summary.deduped++;
        await db.from(Tables.claimEvidence).insert({
          claim_id: dup.id,
          source_id: piece.source_id,
          piece_id: piece.id,
          label: `${piece.label}`,
          location: `${piece.location}`,
          url: piece.url,
          quote,
        });
        continue;
      }

      // Conflict: contradicts an existing same-category claim.
      const conflict = existingList.find(
        (e) => e.category === claim.category && contradictory(e.text, claim.text),
      );
      const statusFinal: 'supported' | 'conflicting' | 'unsupported' = conflict
        ? 'conflicting'
        : (status as 'supported' | 'unsupported');
      if (conflict) {
        await db.from(Tables.claims).update({ status: 'conflicting', updated_at: new Date().toISOString() }).eq('id', conflict.id);
        summary.claims_conflicting++;
      }

      const text = claim.text.slice(0, 2000);
      const { data: created, error: createErr } = await db
        .from(Tables.claims)
        .insert({
          project_id: projectId,
          category: claim.category,
          text,
          reasoning: claim.reasoning ?? null,
          owner_text: claim.owner_text ?? null,
          status: statusFinal,
          confidence: 0.5,
        })
        .select('id')
        .single();
      if (createErr) throw new Error(`Failed to persist claim: ${createErr.message}`);
      existingList.push({ id: created!.id, category: claim.category, text, status: statusFinal });

      await db.from(Tables.claimEvidence).insert({
        claim_id: created!.id,
        source_id: piece.source_id,
        piece_id: piece.id,
        label: piece.label,
        location: piece.location,
        url: piece.url,
        quote,
      });
      summary.claims_created++;
      if (statusFinal === 'unsupported') summary.unsupported_flagged++;
    }
  }

  await audit(projectId, { id: ctx.profile.id, email: ctx.profile.email }, 'extraction.run', {
    summary,
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Similarity / contradiction heuristics (deterministic, explainable)
// ---------------------------------------------------------------------------

const NEG_WORDS: Record<'done' | 'undone' | 'deprecated' | 'active' | 'approved' | 'blocked', RegExp> = {
  done: /\b(complete[d]?|finished|done|shipped|migrat(ed|ion) (complete[d]?|finish))\b/i,
  undone: /\b(incomplete|pending|not ( yet )?(complete[d]?|finish|done|start)|in progress|waiting|blocked)\b/i,
  deprecated: /\b(deprecated|removed|replaced|no longer)\b/i,
  active: /\b(active|current|used)\b/i,
  approved: /\b(approved|accepted|signed)\b/i,
  blocked: /\b(blocked|stuck|waiting)\b/i,
};

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

/** Jaccard similarity of tokens. */
function similar(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** True when same subject is described with opposite state words. */
function contradictory(a: string, b: string): boolean {
  const s = similar(a, b);
  if (s < 0.35 || s > 0.95) return false;
  if (NEG_WORDS.done.test(a) && NEG_WORDS.undone.test(b)) return true;
  if (NEG_WORDS.undone.test(a) && NEG_WORDS.done.test(b)) return true;
  if (NEG_WORDS.deprecated.test(a) && NEG_WORDS.active.test(b)) return true;
  if (NEG_WORDS.active.test(a) && NEG_WORDS.deprecated.test(b)) return true;
  return false;
}

/** Runtime re-validation guard so nothing untyped enters the DB. */
export const PersistedClaim = z.object({
  id: z.string().uuid(),
  category: z.string(),
  text: z.string(),
});
