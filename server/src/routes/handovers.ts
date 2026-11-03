import { Router } from 'express';
import { z } from 'zod';
import {
  Claim,
  ClaimCategory,
  ClaimStatus,
  HandoverClaim,
  HandoverDetail,
  HandoverSection,
  HandoverVersion,
  MemberRole,
  RecipientScope,
  ReviewState,
  SCOPE_DESCRIPTIONS,
  SECTION_KEYS,
  SECTION_TITLES,
  SECTION_BLURBS,
  SECTIONS_BY_SCOPE,
  SectionKey,
  sectionForCategory,
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

const router = Router();

interface HandoverRow {
  id: string;
  project_id: string;
  version: number;
  status: HandoverVersion['status'];
  note: string | null;
  snapshot: { sections: HandoverSection[] } | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

interface RawClaim {
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
  created_at: string;
  sources?: { title: string } | { title: string }[] | null;
}

const createDraft = z.object({ note: z.string().max(1000).optional() });
const patchDraft = z.object({ note: z.string().max(1000) });

function toClaim(raw: RawClaim): Claim {
  const embedded = Array.isArray(raw.sources) ? raw.sources[0] : raw.sources;
  return {
    id: raw.id,
    project_id: raw.project_id,
    category: raw.category,
    text: raw.text,
    original_text: raw.original_text,
    reasoning: raw.reasoning,
    owner_text: raw.owner_text,
    status: raw.status,
    confidence: raw.confidence,
    conflict_group: raw.conflict_group,
    review_state: raw.review_state,
    reviewed_by: raw.reviewed_by,
    reviewed_at: raw.reviewed_at,
    evidence: {
      source_id: raw.source_id,
      source_title: embedded?.title ?? 'Document',
      chunk_id: raw.chunk_id,
      location: raw.location,
      quote: raw.quote,
    },
    created_at: raw.created_at,
  };
}

async function loadClaims(projectId: string): Promise<Claim[]> {
  const { data, error } = await serviceClient()
    .from(Tables.claims)
    .select('*, sources(title)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new HttpError(500, error.message);
  return (data ?? []).map((row) => toClaim(row as RawClaim));
}

function toHandoverClaim(claim: Claim): HandoverClaim {
  return {
    id: claim.id,
    category: claim.category,
    text: claim.text,
    status: claim.status,
    owner_text: claim.owner_text,
    review_state: claim.review_state,
    evidence: claim.evidence,
  };
}

function buildSections(claims: Claim[], allowed: SectionKey[]): HandoverSection[] {
  return allowed.map((key) => ({
    key,
    title: SECTION_TITLES[key],
    blurb: SECTION_BLURBS[key],
    claims: claims
      .filter((c) => c.review_state !== 'excluded' && sectionForCategory(c.category) === key)
      .map(toHandoverClaim),
  }));
}

function statsFor(claims: Claim[]) {
  const count = (fn: (c: Claim) => boolean) => claims.filter(fn).length;
  return {
    total: claims.length,
    supported: count((c) => c.status === 'supported'),
    needs_review: count((c) => c.status === 'needs_review'),
    conflicting: count((c) => c.status === 'conflicting'),
    excluded: count((c) => c.review_state === 'excluded'),
    redacted: count((c) => c.review_state === 'redacted'),
  };
}

async function loadMembership(
  profileId: string,
  projectId: string,
): Promise<{ role: MemberRole; scope: RecipientScope }> {
  const { data } = await serviceClient()
    .from(Tables.projectMembers)
    .select('role, scope')
    .eq('project_id', projectId)
    .eq('user_id', profileId)
    .maybeSingle();
  if (!data) throw new HttpError(403, 'You are not a member of this project');
  return { role: data.role as MemberRole, scope: data.scope as RecipientScope };
}

async function loadHandover(handoverId: string): Promise<HandoverRow> {
  const { data, error } = await serviceClient()
    .from(Tables.handovers)
    .select('*')
    .eq('id', handoverId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'Handover not found');
  return data as HandoverRow;
}

router.get(
  '/projects/:projectId/handovers',
  requireMember(),
  asyncHandler(async (req, res) => {
    const { projectId } = req as MemberRequest;
    const { data, error } = await serviceClient()
      .from(Tables.handovers)
      .select('id, project_id, version, status, note, created_at, approved_at')
      .eq('project_id', projectId)
      .order('version', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    res.json({ handovers: (data ?? []) as HandoverVersion[] });
  }),
);

router.post(
  '/projects/:projectId/handovers',
  requireMember('projectId', ['manager', 'reviewer']),
  asyncHandler(async (req, res) => {
    const body = createDraft.safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, 'Invalid note');
    const { projectId, profile } = req as MemberRequest;
    const db = serviceClient();

    const { data: existing } = await db
      .from(Tables.handovers)
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'draft')
      .maybeSingle();
    if (existing) return res.json({ handover: existing, reused: true });

    const { data: latest } = await db
      .from(Tables.handovers)
      .select('version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = ((latest?.version as number | undefined) ?? 0) + 1;

    const { data: created, error } = await db
      .from(Tables.handovers)
      .insert({
        project_id: projectId,
        version,
        status: 'draft',
        note: body.data.note ?? null,
        created_by: profile.id,
      })
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(projectId, profile.id, 'handover.draft_created', 'handover', created.id as string, {
      version,
    });
    res.status(201).json({ handover: created });
  }),
);

router.get(
  '/handovers/:handoverId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const handover = await loadHandover(String(req.params.handoverId));
    await loadMembership(profile.id, handover.project_id);

    const liveClaims = await loadClaims(handover.project_id);
    const sections = handover.snapshot?.sections ?? buildSections(liveClaims, [...SECTION_KEYS]);

    const { data: project } = await serviceClient()
      .from(Tables.projects)
      .select('id, name')
      .eq('id', handover.project_id)
      .maybeSingle();

    const { data: acks } = await serviceClient()
      .from(Tables.acknowledgements)
      .select('user_id, acknowledged_at')
      .eq('handover_id', handover.id);
    const ackUserIds = (acks ?? []).map((a) => a.user_id as string);
    const { data: ackProfiles } = ackUserIds.length
      ? await serviceClient().from(Tables.profiles).select('id, display_name').in('id', ackUserIds)
      : { data: [] as { id: string; display_name: string }[] };
    const ackNames = new Map((ackProfiles ?? []).map((p) => [p.id as string, p.display_name as string]));

    const detail: HandoverDetail = {
      id: handover.id,
      project_id: handover.project_id,
      version: handover.version,
      status: handover.status,
      note: handover.note,
      created_at: handover.created_at,
      approved_at: handover.approved_at,
      project: {
        id: (project?.id as string) ?? handover.project_id,
        name: (project?.name as string) ?? 'Project',
      },
      sections,
      stats: statsFor(liveClaims),
      acknowledgements: (acks ?? []).map((a) => ({
        user_id: a.user_id as string,
        display_name: ackNames.get(a.user_id as string) ?? null,
        acknowledged_at: a.acknowledged_at as string,
      })),
    };
    res.json({ handover: detail });
  }),
);

router.patch(
  '/handovers/:handoverId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const handover = await loadHandover(String(req.params.handoverId));
    const membership = await loadMembership(profile.id, handover.project_id);
    if (!['manager', 'reviewer'].includes(membership.role)) {
      throw new HttpError(403, 'Only a manager or reviewer can edit a draft');
    }
    if (handover.status !== 'draft') throw new HttpError(409, 'This handover is no longer a draft');

    const body = patchDraft.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'Invalid note');

    const { data: updated, error } = await serviceClient()
      .from(Tables.handovers)
      .update({ note: body.data.note })
      .eq('id', handover.id)
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(handover.project_id, profile.id, 'handover.note_updated', 'handover', handover.id, null);
    res.json({ handover: updated });
  }),
);

router.post(
  '/handovers/:handoverId/approve',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const handover = await loadHandover(String(req.params.handoverId));
    const membership = await loadMembership(profile.id, handover.project_id);
    if (membership.role !== 'manager') throw new HttpError(403, 'Only the project manager can approve');
    if (handover.status !== 'draft') throw new HttpError(409, 'Only a draft can be approved');

    const liveClaims = await loadClaims(handover.project_id);
    const kept = liveClaims.filter((c) => c.review_state !== 'excluded');
    if (!kept.length) throw new HttpError(400, 'There is nothing to approve yet');

    const snapshot = { sections: buildSections(liveClaims, [...SECTION_KEYS]) };
    const db = serviceClient();
    const now = new Date().toISOString();

    await db
      .from(Tables.handovers)
      .update({ status: 'superseded' })
      .eq('project_id', handover.project_id)
      .eq('status', 'approved');

    const { data: approved, error } = await db
      .from(Tables.handovers)
      .update({
        status: 'approved',
        snapshot,
        approved_by: profile.id,
        approved_at: now,
      })
      .eq('id', handover.id)
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(handover.project_id, profile.id, 'handover.approved', 'handover', handover.id, {
      version: handover.version,
      claims: kept.length,
    });
    res.json({ handover: approved });
  }),
);

router.post(
  '/handovers/:handoverId/reject',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const handover = await loadHandover(String(req.params.handoverId));
    const membership = await loadMembership(profile.id, handover.project_id);
    if (membership.role !== 'manager') throw new HttpError(403, 'Only the project manager can reject');
    if (handover.status !== 'draft') throw new HttpError(409, 'Only a draft can be rejected');

    const { error } = await serviceClient()
      .from(Tables.handovers)
      .update({ status: 'rejected' })
      .eq('id', handover.id);
    if (error) throw new HttpError(500, error.message);

    await audit(handover.project_id, profile.id, 'handover.rejected', 'handover', handover.id, null);
    res.json({ ok: true });
  }),
);

router.get(
  '/handovers/:handoverId/recipient',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const handover = await loadHandover(String(req.params.handoverId));
    const membership = await loadMembership(profile.id, handover.project_id);

    // The scope comes from the member row. A query parameter is never trusted.
    if (handover.status !== 'approved') {
      throw new HttpError(409, 'This handover has not been approved yet');
    }

    const sections = handover.snapshot?.sections ?? [];
    const allowed = new Set(SECTIONS_BY_SCOPE[membership.scope]);
    const visible = sections
      .filter((s) => allowed.has(s.key))
      .map((s) => ({ ...s, claims: s.claims.filter((c) => c.review_state !== 'redacted') }));

    const totalClaims = sections.reduce((sum, s) => sum + s.claims.length, 0);
    const visibleClaims = visible.reduce((sum, s) => sum + s.claims.length, 0);

    const { data: ack } = await serviceClient()
      .from(Tables.acknowledgements)
      .select('acknowledged_at')
      .eq('handover_id', handover.id)
      .eq('user_id', profile.id)
      .maybeSingle();

    const { data: project } = await serviceClient()
      .from(Tables.projects)
      .select('id, name')
      .eq('id', handover.project_id)
      .maybeSingle();

    await audit(handover.project_id, profile.id, 'handover.opened', 'handover', handover.id, {
      scope: membership.scope,
    });

    res.json({
      handover: {
        id: handover.id,
        version: handover.version,
        approved_at: handover.approved_at,
        status: handover.status,
      },
      project: {
        id: (project?.id as string) ?? handover.project_id,
        name: (project?.name as string) ?? 'Project',
      },
      scope: membership.scope,
      scope_note: SCOPE_DESCRIPTIONS[membership.scope],
      sections: visible,
      hidden_claim_count: totalClaims - visibleClaims,
      acknowledged_at: (ack?.acknowledged_at as string) ?? null,
      reviewer_note: handover.note,
    });
  }),
);

router.post(
  '/handovers/:handoverId/acknowledge',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const handover = await loadHandover(String(req.params.handoverId));
    await loadMembership(profile.id, handover.project_id);
    if (handover.status !== 'approved') throw new HttpError(409, 'Only an approved handover can be acknowledged');

    const db = serviceClient();
    const { error } = await db.from(Tables.acknowledgements).upsert(
      {
        handover_id: handover.id,
        user_id: profile.id,
        acknowledged_at: new Date().toISOString(),
      },
      { onConflict: 'handover_id,user_id' },
    );
    if (error) throw new HttpError(500, error.message);

    await audit(handover.project_id, profile.id, 'handover.acknowledged', 'handover', handover.id, null);
    res.json({ ok: true });
  }),
);

export default router;
