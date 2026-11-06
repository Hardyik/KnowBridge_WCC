import { Router } from 'express';
import { z } from 'zod';
import {
  Claim,
  ClaimCategory,
  ClaimStatus,
  Confidentiality,
  REVIEW_STATES,
  ReviewState,
  SourceKind,
} from '@knowbridge/shared';
import {
  asyncHandler,
  audit,
  AuthedRequest,
  HttpError,
  MemberRequest,
  requireAuth,
  requireMember,
} from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { attachCorroborations } from '../services/corroboration.js';

const router = Router();

interface ClaimRow {
  id: string;
  project_id: string;
  category: ClaimCategory;
  text: string;
  original_text: string;
  reasoning: string | null;
  owner_text: string | null;
  status: ClaimStatus;
  confidence: number;
  conflict_group: string | null;
  review_state: ReviewState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  source_id: string;
  chunk_id: string;
  location: string;
  quote: string | null;
  occurred_at: string | null;
  confidentiality: Confidentiality | null;
  created_at: string;
  sources?:
    | { title: string; kind?: SourceKind; confidentiality?: Confidentiality }
    | { title: string; kind?: SourceKind; confidentiality?: Confidentiality }[]
    | null;
}

const patchClaim = z.object({
  review_state: z.enum(REVIEW_STATES).optional(),
  text: z.string().min(5).max(400).optional(),
});

router.get(
  '/projects/:projectId/claims',
  requireMember(),
  asyncHandler(async (req, res) => {
    const { projectId } = req as MemberRequest;
    const { data, error } = await serviceClient()
      .from(Tables.claims)
      .select('*, sources(title, kind, confidentiality)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (error) throw new HttpError(500, error.message);

    const claims: Claim[] = (data ?? []).map((raw) => {
      const row = raw as ClaimRow;
      const embedded = Array.isArray(row.sources) ? row.sources[0] : row.sources;
      return {
        id: row.id,
        project_id: row.project_id,
        category: row.category,
        text: row.text,
        original_text: row.original_text,
        reasoning: row.reasoning,
        owner_text: row.owner_text,
        status: row.status,
        confidence: row.confidence,
        conflict_group: row.conflict_group,
        review_state: row.review_state,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at,
        evidence: {
          source_id: row.source_id,
          source_title: embedded?.title ?? 'Document',
          chunk_id: row.chunk_id,
          location: row.location,
          quote: row.quote,
        },
        source_kind: (embedded?.kind as SourceKind) ?? 'document',
        confidentiality: embedded?.confidentiality ?? 'internal',
        occurred_at: row.occurred_at,
        corroborations: [],
        created_at: row.created_at,
      };
    });

    res.json({ claims: attachCorroborations(claims) });
  }),
);

router.patch(
  '/claims/:claimId',
  // The claim carries its project id, so membership is checked after loading
  // it — but the session must still be established first.
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const body = patchClaim.safeParse(req.body);
    if (!body.success || Object.keys(body.data).length === 0) {
      throw new HttpError(400, 'Send review_state and/or a corrected text');
    }

    const db = serviceClient();
    const { data: claim } = await db
      .from(Tables.claims)
      .select('id, project_id, text, review_state')
      .eq('id', req.params.claimId)
      .maybeSingle();
    if (!claim) throw new HttpError(404, 'Claim not found');

    const { data: membership } = await db
      .from(Tables.projectMembers)
      .select('role')
      .eq('project_id', claim.project_id)
      .eq('user_id', profile.id)
      .maybeSingle();
    if (!membership) throw new HttpError(403, 'You are not a member of this project');
    if (!['manager', 'reviewer'].includes(membership.role as string)) {
      throw new HttpError(403, 'Only a manager or reviewer can correct claims');
    }

    const update: Record<string, unknown> = {
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    };
    if (body.data.review_state) update.review_state = body.data.review_state;
    if (body.data.text) update.text = body.data.text;

    const { data: updated, error } = await db
      .from(Tables.claims)
      .update(update)
      .eq('id', req.params.claimId)
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(claim.project_id as string, profile.id, 'claim.reviewed', 'claim', String(claim.id), {
      ...body.data,
      previous_state: claim.review_state,
    });
    res.json({ claim: updated });
  }),
);

export default router;
