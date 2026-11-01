/**
 * Handovers: draft from claims -> reviewer edit -> approve/reject ->
 * versioned. Recipients access an approved handover through a
 * role-aware view that never includes redacted or out-of-role content.
 * Acknowledgement + audit close the loop (doc §2.3).
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  RecipientRoleTag,
  SECTIONS_BY_RECIPIENT_ROLE,
  SECTION_BY_CATEGORY,
  MemberRole,
  HandoverClaimReview,
  ClaimCategory,
} from '@knowbridge/shared';
import { AuthedRequest, asyncHandler, HttpError, audit, requireMember } from '../auth.js';
import { serviceClient, Tables } from '../db.js';

interface ClaimRow {
  id: string;
  project_id: string;
  category: ClaimCategory;
  text: string;
  reasoning: string | null;
  owner_text: string | null;
  status: string;
  evidence?: Array<{ id: string; label: string; location: string; url: string | null; quote: string | null }>;
}

interface HandoverRow {
  id: string;
  project_id: string;
  version: number;
  status: 'draft' | 'approved' | 'rejected';
  claim_reviews: HandoverClaimReview[];
  reviewer_note: string | null;
  created_by: string;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
}

const router = Router();

/** Guard: member of the handover's project, optionally with role check. */
function requireHandoverMember(roles?: MemberRole[]) {
  return (req: AuthedRequest, _res: unknown, next: (e?: unknown) => void) => {
    void (async () => {
      try {
        const handoverId = String(req.params.handoverId ?? '');
        const db = serviceClient();
        const { data: handover, error } = await db
          .from(Tables.handovers)
          .select('id, project_id')
          .eq('id', handoverId)
          .single();
        if (error || !handover) return next(new HttpError(404, 'Handover not found'));
        const { data: membership } = await db
          .from(Tables.projectMembers)
          .select('role')
          .eq('project_id', handover.project_id)
          .eq('user_id', req.profile!.id)
          .maybeSingle();
        if (!membership) return next(new HttpError(403, 'You are not a member of this project'));
        const role = (membership as { role: MemberRole }).role;
        if (roles && !roles.includes(role)) {
          return next(new HttpError(403, `Requires role: ${roles.join(' or ')}`));
        }
        const ctx = req as AuthedRequest & { handover_project_id?: string; memberRole?: MemberRole };
        ctx.handover_project_id = handover.project_id;
        ctx.memberRole = role;
        next();
      } catch {
        next(new HttpError(500, 'Handover access lookup failed'));
      }
    })();
  };
}

// ---------------------------------------------------------------------------
// Create a draft snapshot from the project's current claims
// ---------------------------------------------------------------------------

router.post(
  '/projects/:projectId/handover',
  requireMember('projectId', ['manager', 'reviewer']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const projectId = req.params.projectId!;
    const db = serviceClient();

    const { data: claims } = await db
      .from(Tables.claims)
      .select('id, status, text')
      .eq('project_id', projectId);
    if (!claims || claims.length === 0) {
      throw new HttpError(422, 'Nothing to hand over yet — run extraction first');
    }

    const { data: prev } = await db
      .from(Tables.handovers)
      .select('version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1);

    const version = ((prev?.[0]?.version as number | undefined) ?? 0) + 1;
    const claimReviews: HandoverClaimReview[] = claims.map((c) => ({
      claim_id: c.id,
      edited_text: null,
      action: 'include',
      redact_from_recipients: false,
      verified_by_reviewer: c.status === 'supported',
    }));

    const { data: handover, error } = await db
      .from(Tables.handovers)
      .insert({
        project_id: projectId,
        version,
        status: 'draft',
        claim_reviews: claimReviews,
        created_by: req.profile!.id,
      })
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message);
    await audit(projectId, req.profile!, 'handover.create', { version });
    res.status(201).json({ handover });
  }),
);

// ---------------------------------------------------------------------------
// List versions / read one with joined claims
// ---------------------------------------------------------------------------

router.get(
  '/projects/:projectId/handovers',
  requireMember('projectId'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data } = await serviceClient()
      .from(Tables.handovers)
      .select('*')
      .eq('project_id', req.params.projectId)
      .order('version', { ascending: false });
    res.json({ handovers: data ?? [] });
  }),
);

async function loadHandoverWithClaims(
  handoverId: string,
): Promise<{ handover: HandoverRow; claims: ClaimRow[] }> {
  const db = serviceClient();
  const { data: handover } = await db.from(Tables.handovers).select('*').eq('id', handoverId).single();
  if (!handover) throw new HttpError(404, 'Handover not found');

  const claimIds = (handover.claim_reviews as HandoverClaimReview[]).map((r) => r.claim_id);
  if (claimIds.length === 0) return { handover: handover as HandoverRow, claims: [] };
  const { data: claims } = await db.from(Tables.claims).select('*').in('id', claimIds);
  const { data: evidence } = await db
    .from(Tables.claimEvidence)
    .select('id, claim_id, label, location, url, quote')
    .in('claim_id', claimIds);
  const evByClaim = new Map<string, Array<{ id: string; label: string; location: string; url: string | null; quote: string | null }>>();
  for (const e of evidence ?? []) {
    if (!evByClaim.has(e.claim_id)) evByClaim.set(e.claim_id, []);
    evByClaim.get(e.claim_id)!.push({
      id: e.id,
      label: e.label,
      location: e.location,
      url: e.url,
      quote: e.quote,
    });
  }
  const joined = (claims ?? []).map((c) => ({ ...(c as ClaimRow), evidence: evByClaim.get(c.id) ?? [] }));
  return { handover: handover as HandoverRow, claims: joined };
}

router.get(
  '/handovers/:handoverId',
  requireHandoverMember(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const role = (req as AuthedRequest & { memberRole?: MemberRole }).memberRole;
    const { handover, claims } = await loadHandoverWithClaims(req.params.handoverId!);
    if (role === 'recipient') {
      if (handover.status !== 'approved') throw new HttpError(403, 'Handover not yet approved');
      return res.json(recipientView(handover, claims, 'general', req.profile!.id));
    }
    res.json({ handover, claims });
  }),
);

// ---------------------------------------------------------------------------
// Reviewer edits & approval
// ---------------------------------------------------------------------------

const SaveReviews = z.object({
  claim_reviews: z
    .array(
      z.object({
        claim_id: z.string().uuid(),
        edited_text: z.string().max(4000).nullable().optional(),
        action: z.enum(['include', 'reject']),
        redact_from_recipients: z.boolean().optional(),
        verified_by_reviewer: z.boolean().optional(),
      }),
    )
    .min(0),
  reviewer_note: z.string().max(4000).nullable().optional(),
});

router.patch(
  '/handovers/:handoverId',
  requireHandoverMember(['manager', 'reviewer']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const handoverId = req.params.handoverId!;
    const db = serviceClient();
    const { data: existing } = await db.from(Tables.handovers).select('status, project_id').eq('id', handoverId).single();
    if (!existing) throw new HttpError(404, 'Handover not found');
    if (existing.status !== 'draft') throw new HttpError(409, 'Only drafts can be edited');

    const body = SaveReviews.parse(req.body);
    const { data: handover, error } = await db
      .from(Tables.handovers)
      .update({
        ...(body.claim_reviews ? { claim_reviews: body.claim_reviews } : {}),
        ...(body.reviewer_note !== undefined ? { reviewer_note: body.reviewer_note } : {}),
      })
      .eq('id', handoverId)
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message);
    await audit((existing as { project_id: string }).project_id, req.profile!, 'handover.edit', {
      handover_id: handoverId,
      edits: body.claim_reviews?.length ?? 0,
    });
    res.json({ handover });
  }),
);

const Decision = z.object({ decision: z.enum(['approve', 'reject']) });

router.post(
  '/handovers/:handoverId/decision',
  requireHandoverMember(['manager']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = Decision.parse(req.body);
    const db = serviceClient();
    const now = new Date().toISOString();
    const { data: handover, error } = await db
      .from(Tables.handovers)
      .update({
        status: body.decision === 'approve' ? 'approved' : 'rejected',
        approved_at: body.decision === 'approve' ? now : null,
        approved_by: body.decision === 'approve' ? req.profile!.id : null,
      })
      .eq('id', req.params.handoverId)
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message);
    await audit((handover as HandoverRow).project_id, req.profile!, `handover.${body.decision}`, {
      handover_id: req.params.handoverId,
    });
    res.json({ handover });
  }),
);

// ---------------------------------------------------------------------------
// Role-aware recipient view + acknowledgement
// ---------------------------------------------------------------------------

/** Builds the recipient-safe payload: no redacted claims, role-scoped sections. */
function recipientView(
  handover: HandoverRow,
  claims: ClaimRow[],
  roleTag: RecipientRoleTag,
  viewerId: string,
) {
  const allowed: string[] | 'all' = SECTIONS_BY_RECIPIENT_ROLE[roleTag];
  const reviews = new Map(
    handover.claim_reviews.map((r) => [r.claim_id, r] as const),
  );
  const pairs = claims.map((claim) => ({ claim, review: reviews.get(claim.id) }));
  const visible = pairs
    .filter(({ review }) => review?.action !== 'reject' && review?.redact_from_recipients !== true)
    .filter(({ claim }) => allowed === 'all' || allowed.includes(SECTION_BY_CATEGORY[claim.category] as string))
    .map(({ claim, review }) => ({
      ...claim,
      text: review?.edited_text ?? claim.text,
      review_status: review && review.verified_by_reviewer ? 'verified' : 'unverified',
    }));
  return {
    handover: {
      id: handover.id,
      version: handover.version,
      status: handover.status,
      approved_at: handover.approved_at,
      reviewer_note: handover.reviewer_note,
    },
    recipient_viewer_id: viewerId,
    role_tag: roleTag,
    claims: visible,
    sections: HANDOVER_SECTIONS_ORDER,
  };
}

const HANDOVER_SECTIONS_ORDER = [
  'overview',
  'completed',
  'pending',
  'key_decisions',
  'ownership',
  'risks',
  'dependencies',
  'next_actions',
  'open_questions',
] as const;

const RECIPIENT_ROLES_DICT: Record<string, RecipientRoleTag> = {
  manager: 'manager',
  reviewer: 'engineer',
  engineer: 'engineer',
  coordinator: 'coordinator',
  general: 'general',
};

router.get(
  '/handovers/:handoverId/recipient-view',
  requireHandoverMember(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const role = (req as AuthedRequest & { memberRole?: MemberRole }).memberRole;
    const roleTag: RecipientRoleTag =
      RECIPIENT_ROLES_DICT[String(req.query.role ?? '')] ??
      (role === 'recipient' ? 'general' : 'engineer');
    const { handover, claims } = await loadHandoverWithClaims(req.params.handoverId!);
    if (handover.status !== 'approved') {
      throw new HttpError(403, 'Handover is not approved yet');
    }
    res.json(recipientView(handover, claims, roleTag, req.profile!.id));
  }),
);

router.post(
  '/handovers/:handoverId/acknowledge',
  requireHandoverMember(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const db = serviceClient();
    const { data: handover } = await db
      .from(Tables.handovers)
      .select('id, project_id, status')
      .eq('id', req.params.handoverId)
      .single();
    if (!handover) throw new HttpError(404, 'Handover not found');
    if (handover.status !== 'approved') throw new HttpError(409, 'Only approved handovers can be acknowledged');

    const { error } = await db.from(Tables.acknowledgements).upsert(
      { handover_id: handover.id, user_id: req.profile!.id },
      { onConflict: 'handover_id,user_id' },
    );
    if (error) throw new HttpError(400, error.message);
    await audit(handover.project_id, req.profile!, 'handover.acknowledge', { handover_id: handover.id });
    res.json({ ok: true });
  }),
);

router.get(
  '/handovers/:handoverId/acknowledgements',
  requireHandoverMember(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data } = await serviceClient()
      .from(Tables.acknowledgements)
      .select('id, handover_id, user_id, acknowledged_at')
      .eq('handover_id', req.params.handoverId);
    res.json({ acknowledgements: data ?? [] });
  }),
);

export default router;
