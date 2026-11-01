/**
 * Extraction run + claims review endpoints (doc §2.2 steps 2-3, §3.4).
 */
import { Router } from 'express';
import { z } from 'zod';
import { MemberRole } from '@knowbridge/shared';
import { AuthedRequest, asyncHandler, HttpError, audit, requireAuth, requireMember } from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { runExtraction } from '../services/extraction.js';

const router = Router();

router.post(
  '/projects/:projectId/extract',
  requireMember('projectId', ['manager', 'reviewer']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const summary = await runExtraction(req as never);
    res.json({ summary });
  }),
);

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

router.get(
  '/projects/:projectId/claims',
  requireMember('projectId'),
  asyncHandler(async (req, res) => {
    const db = serviceClient();
    const { data: claims } = await db
      .from(Tables.claims)
      .select('*')
      .eq('project_id', req.params.projectId)
      .order('created_at', { ascending: true });
    const ids = (claims ?? []).map((c) => c.id);
    const { data: evidence } =
      ids.length > 0
        ? await db.from(Tables.claimEvidence).select('*').in('claim_id', ids)
        : { data: [] };
    const byClaim = new Map<string, unknown[]>();
    for (const e of evidence ?? []) {
      if (!byClaim.has(e.claim_id)) byClaim.set(e.claim_id, []);
      byClaim.get(e.claim_id)!.push(e);
    }
    res.json({
      claims: (claims ?? []).map((c) => ({ ...c, evidence: byClaim.get(c.id) ?? [] })),
    });
  }),
);

/**
 * Load a claim and verify the caller is a member of its project.
 * Shared by GET (member read) and PATCH (reviewer/manager write).
 */
async function loadClaimForMember(claimId: string, userId: string) {
  const db = serviceClient();
  const { data: claim } = await db
    .from(Tables.claims)
    .select('id, project_id')
    .eq('id', claimId)
    .single();
  if (!claim) throw new HttpError(404, 'Claim not found');
  const { data: membership } = await db
    .from(Tables.projectMembers)
    .select('role')
    .eq('project_id', claim.project_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) throw new HttpError(403, 'You are not a member of this project');
  return { claim: claim as { id: string; project_id: string }, role: membership.role as MemberRole };
}

router.get(
  '/claims/:claimId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { claim } = await loadClaimForMember(req.params.claimId!, req.profile!.id);
    const db = serviceClient();
    const { data: full } = await db
      .from(Tables.claims)
      .select('*')
      .eq('id', claim.id)
      .single();
    if (!full) throw new HttpError(404, 'Claim not found');
    const { data: evidence } = await db
      .from(Tables.claimEvidence)
      .select('*')
      .eq('claim_id', claim.id);
    res.json({ claim: { ...full, evidence: evidence ?? [] } });
  }),
);

const PatchClaim = z.object({
  status: z.enum(['supported', 'needs_review', 'conflicting', 'unsupported']).optional(),
  text: z.string().min(1).max(4000).optional(),
  owner_text: z.string().max(300).nullable().optional(),
  reasoning: z.string().max(4000).nullable().optional(),
});

router.patch(
  '/claims/:claimId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Permission check: caller must be a reviewer/manager of the claim's project.
    const db = serviceClient();
    const { claim, role } = await loadClaimForMember(req.params.claimId!, req.profile!.id);
    if (role === 'recipient') {
      throw new HttpError(403, 'Reviewer or manager role required to edit claims');
    }

    const body = PatchClaim.parse(req.body);
    const { data: updated, error } = await db
      .from(Tables.claims)
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', claim.id)
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message);
    await audit(claim.project_id, req.profile!, 'claim.edit', {
      claim_id: claim.id,
      changes: Object.keys(body),
    });
    res.json({ claim: { ...updated, evidence: [] } });
  }),
);

export default router;
