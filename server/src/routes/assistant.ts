/**
 * AI assistant over the project's own knowledge.
 *
 * The assistant never answers from general knowledge: its context is the
 * approved handover snapshot (or the live claims before approval), already
 * filtered by the member's scope and each claim's confidentiality tier. Every
 * answer must cite the claims it used, and an answer that is not in the
 * knowledge base says so instead of guessing.
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  AssistantCitation,
  AssistantMessage,
  AssistantReply,
  Confidentiality,
  HandoverSection,
  RecipientScope,
  SECTIONS_BY_SCOPE,
  tierVisibleToScope,
} from '@knowbridge/shared';
import { asyncHandler, audit, HttpError, MemberRequest, requireMember } from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { completeJson } from '../services/llm.js';
import { subjectTokens } from '../services/similarity.js';
import { withCurrentTiers } from '../services/scoping.js';

const router = Router();

const askBody = z.object({
  question: z.string().min(3).max(600),
});

interface ContextClaim {
  ref: string;
  id: string;
  category: string;
  text: string;
  source_title: string;
  location: string;
  quote: string | null;
  occurred_at: string | null;
  source_kind: string;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: AssistantCitation[] | null;
  created_at: string;
}

const MAX_CONTEXT_CLAIMS = 120;
const MAX_CONTEXT_CHARS = 11_000;

/**
 * A handover can hold far more claims than fit in one prompt, so the context is
 * the most relevant subset rather than the first N. These hints map the way a
 * person asks to the categories that answer them.
 */
const CATEGORY_HINTS: { match: RegExp; categories: string[] }[] = [
  { match: /pend|open|unfinished|outstanding|remain|left/i, categories: ['pending'] },
  { match: /next|first|start|do now|action|step/i, categories: ['next_action'] },
  { match: /owner|who|responsib|contact|ask/i, categories: ['owner', 'contact'] },
  { match: /risk|blocker|concern|danger|worry|issue/i, categories: ['risk', 'blocker'] },
  { match: /decision|decide|why|chose|choice|reason/i, categories: ['decision'] },
  { match: /setup|run|deploy|install|environment|build/i, categories: ['setup'] },
  { match: /depend|vendor|approv|external|block/i, categories: ['dependency'] },
  { match: /done|complete|finished|shipped|live/i, categories: ['completed'] },
];

function rankForQuestion(claims: ContextClaim[], question: string): ContextClaim[] {
  const hinted = new Set(
    CATEGORY_HINTS.filter((hint) => hint.match.test(question)).flatMap((hint) => hint.categories),
  );
  const asked = subjectTokens(question);

  return claims
    .map((claim) => {
      const matched = subjectTokens(`${claim.text} ${claim.quote ?? ''}`);
      let shared = 0;
      for (const token of asked) if (matched.has(token)) shared += 1;
      return {
        claim,
        score: (hinted.has(claim.category) ? 3 : 0) + shared * 1.5,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => row.claim);
}

const SYSTEM_PROMPT = `You are the KnowBridge assistant. You answer questions about one project using only the numbered context claims you are given — extracted, evidence-checked statements from the project's own documents and connected repository.

Rules:
1. Answer only from the context. If the context does not contain the answer, say plainly that the handover does not record it, and name what is missing. Never fill gaps with general knowledge or guesses.
2. Cite every claim you rely on with its bracket id, for example C4. Use ids exactly as given.
3. Never invent owners, dates, decisions or statuses. If a claim has no owner, say the owner is not confirmed.
4. When two claims contradict each other, present both and say the reviewer has to decide; do not choose a winner.
5. Answer in at most 180 words. Use short bullets when listing.
6. Speak about the project, not about the documents: no "the context says".

Return strict JSON: {"answer":"...","citations":["C1","C2"],"grounded":true}
Set "grounded" to false and keep "citations" empty when the answer is not in the context.`;

type Membership = { role: string; scope: RecipientScope };

/** Approved snapshot first, live claims before approval, both scope-filtered. */
async function loadContext(
  projectId: string,
  membership: Membership,
): Promise<{ claims: ContextClaim[]; hidden: number; source: 'snapshot' | 'live' }> {
  const db = serviceClient();
  const team = membership.role === 'manager' || membership.role === 'reviewer';

  const { data: approved } = await db
    .from(Tables.handovers)
    .select('id, version, snapshot')
    .eq('project_id', projectId)
    .eq('status', 'approved')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const snapshotSections = (approved?.snapshot as { sections?: HandoverSection[] } | null)?.sections;
  if (snapshotSections?.length) {
    const sections = await withCurrentTiers(snapshotSections);
    const allowed = new Set(SECTIONS_BY_SCOPE[membership.scope]);
    const visible: ContextClaim[] = [];
    let hidden = 0;
    let ref = 0;

    for (const section of sections) {
      const sectionAllowed = allowed.has(section.key);
      for (const claim of section.claims) {
        const tier = (claim.confidentiality ?? 'internal') as Confidentiality;
        const shown =
          claim.review_state !== 'redacted' &&
          (team || (sectionAllowed && tierVisibleToScope(tier, membership.scope)));
        if (!shown) {
          hidden += 1;
          continue;
        }
        ref += 1;
        visible.push({
          ref: `C${ref}`,
          id: claim.id,
          category: claim.category,
          text: claim.text,
          source_title: claim.evidence.source_title,
          location: claim.evidence.location,
          quote: claim.evidence.quote,
          occurred_at: claim.occurred_at ?? null,
          source_kind: claim.source_kind ?? 'document',
        });
      }
    }
    return { claims: visible, hidden, source: 'snapshot' };
  }

  const { data: rows, error } = await db
    .from(Tables.claims)
    .select('id, category, text, location, quote, occurred_at, review_state, sources(title, kind, confidentiality)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new HttpError(500, error.message);

  const visible: ContextClaim[] = [];
  let hidden = 0;
  let ref = 0;
  for (const row of rows ?? []) {
    const embedded = Array.isArray(row.sources) ? row.sources[0] : row.sources;
    const tier = ((embedded?.confidentiality as Confidentiality) ?? 'internal') as Confidentiality;
    const usable = row.review_state !== 'excluded' && row.review_state !== 'redacted';
    const shown = usable && (team || tierVisibleToScope(tier, membership.scope));
    if (!shown) {
      hidden += 1;
      continue;
    }
    ref += 1;
    visible.push({
      ref: `C${ref}`,
      id: row.id as string,
      category: row.category as string,
      text: row.text as string,
      source_title: (embedded?.title as string) ?? 'Document',
      location: (row.location as string) ?? '',
      quote: (row.quote as string) ?? null,
      occurred_at: (row.occurred_at as string) ?? null,
      source_kind: (embedded?.kind as string) ?? 'document',
    });
  }
  return { claims: visible, hidden, source: 'live' };
}

function buildContextPrompt(claims: ContextClaim[], projectName: string, question: string): string {
  let budget = MAX_CONTEXT_CHARS;
  const blocks: string[] = [];
  for (const claim of rankForQuestion(claims, question).slice(0, MAX_CONTEXT_CLAIMS)) {
    const block = [
      `[${claim.ref}] ${claim.category} · ${claim.source_title}${claim.location ? ` · ${claim.location}` : ''}` +
        `${claim.occurred_at ? ` · ${claim.occurred_at.slice(0, 10)}` : ''} · ${claim.source_kind}`,
      claim.text,
      claim.quote ? `Quote: "${claim.quote.slice(0, 220)}"` : 'Quote: none recorded',
    ].join('\n');
    if (block.length > budget) break;
    budget -= block.length;
    blocks.push(block);
  }
  return `Project: ${projectName}\n\nContext claims (the most relevant subset of the handover):\n${blocks.join('\n\n')}`;
}

function parseAnswer(content: string): { answer: string; citations: string[]; grounded: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return { answer: content.trim().slice(0, 1200), citations: [], grounded: false };
  }
  const row = parsed as Record<string, unknown>;
  const answer = String(row.answer ?? '').trim();
  const citations = Array.isArray(row.citations)
    ? row.citations.filter((id): id is string => typeof id === 'string')
    : [];
  return { answer: answer.slice(0, 2000), citations, grounded: row.grounded !== false };
}

router.get(
  '/projects/:projectId/assistant',
  requireMember(),
  asyncHandler(async (req, res) => {
    const { projectId, profile } = req as MemberRequest;
    const { data, error } = await serviceClient()
      .from(Tables.assistantMessages)
      .select('id, role, content, citations, created_at')
      .eq('project_id', projectId)
      .eq('user_id', profile.id)
      .order('created_at', { ascending: true })
      .limit(60);
    if (error) throw new HttpError(500, error.message);
    res.json({ messages: (data ?? []) as MessageRow[] });
  }),
);

router.delete(
  '/projects/:projectId/assistant',
  requireMember(),
  asyncHandler(async (req, res) => {
    const { projectId, profile } = req as MemberRequest;
    const { error } = await serviceClient()
      .from(Tables.assistantMessages)
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', profile.id);
    if (error) throw new HttpError(500, error.message);
    res.json({ ok: true });
  }),
);

router.post(
  '/projects/:projectId/assistant',
  requireMember(),
  asyncHandler(async (req, res) => {
    const { projectId, profile, membership } = req as MemberRequest;
    const body = askBody.safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, 'Ask a question first');

    const db = serviceClient();
    const [{ data: project }, { data: history }] = await Promise.all([
      db.from(Tables.projects).select('name').eq('id', projectId).maybeSingle(),
      db
        .from(Tables.assistantMessages)
        .select('role, content')
        .eq('project_id', projectId)
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(6),
    ]);

    const { claims, hidden, source } = await loadContext(projectId, membership);
    if (!claims.length) {
      throw new HttpError(
        409,
        source === 'snapshot'
          ? 'The approved handover contains nothing your scope can see'
          : 'There is nothing extracted yet — add sources and run extraction first',
      );
    }

    const recent = (history ?? [])
      .slice()
      .reverse()
      .map((row) => `${row.role === 'user' ? 'Person' : 'Assistant'}: ${String(row.content).slice(0, 300)}`)
      .join('\n');

    const user = [
      buildContextPrompt(claims, (project?.name as string) ?? 'Project', body.data.question),
      '',
      recent ? `Earlier in this conversation:\n${recent}\n` : '',
      `Question: ${body.data.question.trim()}`,
    ].join('\n');

    const content = await completeJson(SYSTEM_PROMPT, user);
    const parsed = parseAnswer(content);

    const byRef = new Map(claims.map((claim) => [claim.ref.toUpperCase(), claim]));
    const citationClaims = [...new Set(parsed.citations.map((ref) => ref.toUpperCase()))]
      .map((ref) => byRef.get(ref))
      .filter((claim): claim is ContextClaim => Boolean(claim));

    const citations: AssistantCitation[] = citationClaims.map((claim) => ({
      claim_id: claim.id,
      text: claim.text,
      category: claim.category as AssistantCitation['category'],
      source_title: claim.source_title,
      source_kind: claim.source_kind as AssistantCitation['source_kind'],
      location: claim.location,
      quote: claim.quote,
    }));

    const grounded = parsed.grounded && Boolean(parsed.answer) && citations.length > 0;

    await db.from(Tables.assistantMessages).insert({
      project_id: projectId,
      user_id: profile.id,
      role: 'user',
      content: body.data.question.trim(),
      citations: null,
    });

    const { data: stored, error } = await db
      .from(Tables.assistantMessages)
      .insert({
        project_id: projectId,
        user_id: profile.id,
        role: 'assistant',
        content: parsed.answer || 'The handover does not record an answer to that question.',
        citations,
      })
      .select('id, role, content, citations, created_at')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(projectId, profile.id, 'assistant.asked', 'project', projectId, {
      grounded,
      citations: citations.length,
      scope: membership.scope,
    });

    const reply: AssistantReply = {
      message: stored as AssistantMessage,
      grounded,
      context_claims: claims.length,
      hidden_by_scope: hidden,
    };
    res.status(201).json(reply);
  }),
);

export default router;
