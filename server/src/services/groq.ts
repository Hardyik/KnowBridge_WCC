/**
 * Groq (OpenAI-compatible) structured extraction.
 *
 * Anti-hallucination contract (doc §3.4, inspired by RepoWise's prompt
 * stack): the model may SKIP content it cannot ground; it may never invent
 * owners, dates, statuses or IDs; every emitted claim must carry an exact
 * quote from the analysed text; a claim without a quote is, by definition,
 * unsupported and will be stored as `unsupported`, never as a fact.
 *
 * Output is strict JSON, validated with the shared zod schema before it is
 * ever written to the database. Invalid records are dropped, not repaired.
 */
import { z } from 'zod';
import { ClaimCategory, ExtractedClaimSchema, ExtractedClaim } from '@knowbridge/shared';
import { config } from '../config.js';

const API = 'https://api.groq.com/openai/v1/chat/completions';

const MintedShape = z.object({
  claims: z.array(
    ExtractedClaimSchema.extend({
      category: ClaimCategory,
      quote: z.string().nullable().optional(),
    }),
  ),
});

const SYSTEM_PROMPT = `You extract structured project-knowledge "claims" from project material (documents, repo files, issues, commit messages) so that a replacement team member can continue the work after the previous owner left.

STRICT RULES — violating them makes output unusable:
1. Use ONLY the supplied text. Never use outside knowledge.
2. Every claim MUST include an "quote" that is copied VERBATIM (a span of a few words up to one sentence) from the supplied text.
3. If no real quote exists in the text, you may still emit the claim ONLY if you set "quote": null AND "unsupported": true — meaning "I read this but cannot pin it to an exact place". Never fabricate a quote.
4. SKIP anything you cannot ground at all. Skipping is correct and desired; inventing is forbidden.
5. For "owner" claims (who is responsible / who to consult): only emit if a person or named team is actually identified in text. NEVER guess. If nobody is named, do not emit an owner claim at all — the system itself will display "Owner not confirmed".
6. For "decision" claims include "reasoning" as an exact or tight paraphrase of the stated reason ONLY IF the text states a reason. If the text only records the decision without a reason, omit "reasoning" (set null).
7. Do not merge unrelated facts; do not editorialize; keep "text" self-contained ("Payment gateway integration is pending" not "It is pending").
8. Category meanings:
   - decision: a choice that was made about architecture, tools, process, scope
   - task: work that is open / pending / unfinished (NOT completed work)
   - risk: something that may delay or break the project
   - dependency: something that depends on something else, or an external system integration
   - owner: a specific person/team responsible for a specific thing named in the text
   - setup: deployment, environment, credentials, runbook details
   - contact: stakeholder / vendor / named contact with coordination context
   - other: important but none of the above
9. Output JSON object: {"claims": [...]} with fields: category, text, reasoning?, owner_text?, quote?, unsupported?. Nothing else.
If the text contains nothing worth extracting, output {"claims": []}. Empty is a valid and good answer.`;

export async function extractClaimsFromText(
  text: string,
  groqApiKey: string,
  model: string,
): Promise<ExtractedClaim[]> {
  if (!groqApiKey) throw new Error('GROQ_API_KEY is not set');
  if (!text.trim()) return [];

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      // JSON output mode — responses are parseable; validation still applied.
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, 12000) },
      ],
    }),
  });

  if (res.status === 429) throw new Error('Groq rate limit — retry shortly');
  if (res.status === 401) throw new Error('Groq API key invalid');
  if (!res.ok) throw new Error(`Groq API error ${res.status}`);

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content ?? '';

  const parsed = MintedShape.safeParse(safeJson(content));
  if (!parsed.success) return [];
  // Cap pathological outputs.
  return parsed.data.claims.slice(0, 40);
}

function safeJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    // Groq JSON mode should never hit this; treat garbage as empty.
    return { claims: [] };
  }
}
