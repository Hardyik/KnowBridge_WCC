import {
  CLAIM_CATEGORIES,
  ClaimCategory,
  ClaimStatus,
  ExtractionSummary,
  OWNER_UNCONFIRMED,
} from '@knowbridge/shared';
import { HttpError } from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { completeJson } from './llm.js';
import { normalise } from './documents.js';

interface ChunkRow {
  id: string;
  source_id: string;
  ordinal: number;
  heading: string;
  text: string;
}

interface DraftClaim {
  category: ClaimCategory;
  text: string;
  quote: string | null;
  reasoning: string | null;
  owner_text: string | null;
}

interface StoredClaim {
  id: string;
  text: string;
  source_id: string;
  chunk_id: string;
  status: ClaimStatus;
}

const SYSTEM_PROMPT = `You are the extraction engine of KnowBridge, a knowledge-handover tool for software teams.
You receive one chunk of a project document and return atomic, evidence-backed claims an incoming team member needs.

Categories (pick exactly one per claim):
- decision: a choice that was made, and why if the text says why
- completed: work the text describes as done
- pending: work that is open, unfinished or awaiting something
- next_action: an instruction or step someone should perform next
- owner: a named person/team responsible for something
- contact: a named person/team to consult, with their role
- risk: a risk, hazard, caveat or unverified assumption
- blocker: something currently preventing progress
- dependency: a system, team, approval or component something relies on
- setup: how the project is built, configured or run

Rules:
1. Only state what this chunk says. Never infer, embellish or add general knowledge.
2. "quote" must be an exact substring copied from the chunk (max 300 characters). If you cannot quote it, omit the claim.
3. Never invent owners, dates, statuses or decisions. Set "owner_text" only when a person or team is named in this chunk for that item, otherwise null.
4. Skip navigation, table-of-contents lines, boilerplate, marketing, licence text and repeated headers.
5. Write "text" as one clear third-person sentence, no hedging, no "the document says".
6. "reasoning" is one short sentence on why this matters to someone taking over.
7. Return at most 12 claims, the most useful ones first.

Return strict JSON: {"claims":[{"category":"decision","text":"...","quote":"...","reasoning":"...","owner_text":null}]}`;

/** Coerce one model row into a DraftClaim, or null when unusable. */
function toDraft(raw: unknown): DraftClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const category = String(row.category ?? '').toLowerCase().trim() as ClaimCategory;
  if (!CLAIM_CATEGORIES.includes(category)) return null;

  const text = String(row.text ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 12 || text.length > 400) return null;

  const quoteRaw = row.quote === null || row.quote === undefined ? '' : String(row.quote).trim();
  const ownerRaw = row.owner_text === null || row.owner_text === undefined ? '' : String(row.owner_text).trim();
  const reasoningRaw =
    row.reasoning === null || row.reasoning === undefined ? '' : String(row.reasoning).trim();

  return {
    category,
    text,
    quote: quoteRaw ? quoteRaw.slice(0, 320) : null,
    reasoning: reasoningRaw ? reasoningRaw.slice(0, 240) : null,
    owner_text: ownerRaw ? ownerRaw.slice(0, 120) : null,
  };
}

async function extractChunk(chunk: ChunkRow, sourceTitle: string): Promise<DraftClaim[]> {
  const user = `Source: ${sourceTitle}
Section: ${chunk.heading}

--- chunk start ---
${chunk.text}
--- chunk end ---`;

  const content = await completeJson(SYSTEM_PROMPT, user);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  const rows = (parsed as { claims?: unknown[] }).claims;
  if (!Array.isArray(rows)) return [];
  return rows.map(toDraft).filter((c): c is DraftClaim => Boolean(c));
}

/** Does the quote actually appear in the chunk? Returns the review status. */
function evidenceStatus(chunkText: string, quote: string | null): ClaimStatus {
  if (!quote) return 'unsupported';
  return normalise(chunkText).includes(normalise(quote)) ? 'supported' : 'needs_review';
}

function runsWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  return Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Conflict detection (deterministic, inspectable — no model involved)
// ---------------------------------------------------------------------------

const OPPOSING_POLES: [RegExp, RegExp][] = [
  [
    /\bpending\b|\bnot yet\b|\bunfinished\b|\bin progress\b|\bawaiting\b/,
    /\b(complete|completed|done|finished|released|deployed|live|shipped)\b/,
  ],
  [
    /\b(disabled|removed|retired|decommissioned|deprecated|revoked)\b/,
    /\b(enabled|active|in use|live|still available|still reachable|still running)\b/,
  ],
  [/\bblocked\b|\bcannot proceed\b/, /\bunblocked\b|\bresolved\b|\bno longer blocks\b/],
  [/\bnot deployed\b|\bnot released\b|\bnot shipped\b/, /\bdeployed\b|\breleased\b|\bshipped\b/],
];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'have', 'has', 'was', 'were',
  'are', 'not', 'but', 'its', 'their', 'they', 'will', 'been', 'being', 'which', 'when',
  'than', 'then', 'also', 'only', 'still', 'yet', 'all', 'any', 'can', 'may', 'must', 'has',
  'had', 'our', 'your', 'over', 'under', 'after', 'before', 'used', 'using', 'via',
]);

function subjectTokens(text: string): Set<string> {
  return new Set(
    normalise(text)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

export interface ConflictGroup {
  groupId: string;
  claimIds: string[];
}

/**
 * Two claims conflict when they talk about the same subject but sit on
 * opposite poles of it ("rollout pending" vs "rollout complete"). We show both
 * to the reviewer instead of picking one.
 */
export function detectConflicts(claims: StoredClaim[]): ConflictGroup[] {
  const groups: ConflictGroup[] = [];
  const claimed = new Set<string>();

  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i];
      const b = claims[j];
      if (a.id === b.id || claimed.has(a.id) || claimed.has(b.id)) continue;
      if (a.chunk_id === b.chunk_id) continue;

      const textA = normalise(a.text);
      const textB = normalise(b.text);
      let opposite = false;
      for (const [poleOne, poleTwo] of OPPOSING_POLES) {
        if ((poleOne.test(textA) && poleTwo.test(textB)) || (poleTwo.test(textA) && poleOne.test(textB))) {
          opposite = true;
          break;
        }
      }
      if (!opposite) continue;
      if (overlap(subjectTokens(a.text), subjectTokens(b.text)) < 0.4) continue;

      const groupId = `conflict-${groups.length + 1}`;
      groups.push({ groupId, claimIds: [a.id, b.id] });
      claimed.add(a.id);
      claimed.add(b.id);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runExtraction(projectId: string): Promise<ExtractionSummary> {
  const db = serviceClient();

  const { data: sources, error: sourceError } = await db
    .from(Tables.sources)
    .select('id, title, status')
    .eq('project_id', projectId);
  if (sourceError) throw new HttpError(500, sourceError.message);

  const ready = (sources ?? []).filter((s) => s.status === 'ready');
  const failed = (sources ?? []).filter((s) => s.status === 'failed').map((s) => s.title);
  if (!ready.length) throw new HttpError(400, 'Upload at least one readable document first');

  const sourceTitle = new Map(ready.map((s) => [s.id as string, s.title as string]));
  const { data: chunks, error: chunkError } = await db
    .from(Tables.sourceChunks)
    .select('id, source_id, ordinal, heading, text')
    .in('source_id', ready.map((s) => s.id))
    .order('source_id', { ascending: true })
    .order('ordinal', { ascending: true });
  if (chunkError) throw new HttpError(500, chunkError.message);
  const chunkRows = (chunks ?? []) as ChunkRow[];
  if (!chunkRows.length) throw new HttpError(400, 'Those documents produced no readable text');

  const { data: existing } = await db
    .from(Tables.claims)
    .select('text, chunk_id')
    .eq('project_id', projectId);
  const existingRows = (existing ?? []) as { text: string; chunk_id: string }[];
  const seen = new Set(existingRows.map((c) => normalise(c.text)));

  // Incremental extraction: passages that already produced claims are skipped,
  // so a rate-limited run can simply be repeated to finish the job.
  const doneChunks = new Set(existingRows.map((c) => c.chunk_id));
  const pendingChunks = chunkRows.filter((chunk) => !doneChunks.has(chunk.id));

  let created = 0;
  let duplicates = 0;
  let unsupported = 0;
  let needsReview = 0;
  let ownerGaps = 0;
  const failures: string[] = [];

  await runsWithConcurrency(pendingChunks, 2, async (chunk) => {
    const title = sourceTitle.get(chunk.source_id) ?? 'Document';
    let drafts: DraftClaim[];
    try {
      drafts = await extractChunk(chunk, title);
    } catch (err) {
      failures.push(`${title} / ${chunk.heading}: ${(err as Error).message}`);
      return;
    }
    if (!drafts.length) return;

    // Ownership gaps are only meaningful when this chunk names nobody at all.
    const ownerNames = drafts
      .map((d) => d.owner_text)
      .filter((n): n is string => Boolean(n));

    const rows = [];
    const batchSeen = new Set<string>();
    for (const draft of drafts) {
      const key = normalise(draft.text);
      if (seen.has(key) || batchSeen.has(key)) {
        duplicates += 1;
        continue;
      }
      batchSeen.add(key);

      const status = evidenceStatus(chunk.text, draft.quote);
      if (status === 'unsupported') unsupported += 1;
      if (status === 'needs_review') needsReview += 1;

      const ownerText =
        draft.owner_text ??
        ((draft.category === 'decision' || draft.category === 'owner') && ownerNames.length === 0
          ? OWNER_UNCONFIRMED
          : null);
      if (ownerText === OWNER_UNCONFIRMED) ownerGaps += 1;

      rows.push({
        project_id: projectId,
        source_id: chunk.source_id,
        chunk_id: chunk.id,
        category: draft.category,
        text: draft.text,
        original_text: draft.text,
        quote: draft.quote,
        location: chunk.heading,
        reasoning: draft.reasoning,
        owner_text: ownerText,
        status,
        confidence: status === 'supported' ? 0.9 : status === 'needs_review' ? 0.45 : 0.2,
      });
      seen.add(key);
    }

    if (!rows.length) return;
    const { data: inserted, error: insertError } = await db
      .from(Tables.claims)
      .insert(rows)
      .select('id, text');
    if (insertError) {
      failures.push(`${title} / ${chunk.heading}: ${insertError.message}`);
      return;
    }
    created += inserted?.length ?? 0;
  });

  const { data: allClaims } = await db
    .from(Tables.claims)
    .select('id, text, source_id, chunk_id, status')
    .eq('project_id', projectId);
  const groups = detectConflicts((allClaims ?? []) as StoredClaim[]);
  for (const group of groups) {
    await db
      .from(Tables.claims)
      .update({ status: 'conflicting', conflict_group: group.groupId, confidence: 0.5 })
      .in('id', group.claimIds);
  }

  await db.from(Tables.projects).update({ last_extracted_at: new Date().toISOString() }).eq('id', projectId);

  return {
    chunks: chunkRows.length,
    claims_created: created,
    duplicates_skipped: duplicates,
    conflicts: groups.length,
    unsupported,
    needs_review: needsReview,
    owner_gaps: ownerGaps,
    sources_failed: [...failed, ...failures],
  } satisfies ExtractionSummary;
}
