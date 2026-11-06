import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import {
  Claim,
  ClaimCategory,
  ClaimStatus,
  Confidentiality,
  DeliveryLink,
  DeliveryStatus,
  HandoverClaim,
  HandoverDetail,
  HandoverDiff,
  HandoverSection,
  HandoverVersion,
  MemberRole,
  RecipientScope,
  ReviewState,
  RECIPIENT_SCOPES,
  SCOPE_DESCRIPTIONS,
  SECTION_KEYS,
  SECTION_TITLES,
  SECTION_BLURBS,
  SectionKey,
  SourceKind,
  sectionForCategory,
} from '@knowbridge/shared';
import { config } from '../config.js';
import { scopedSections, withCurrentTiers } from '../services/scoping.js';
import { attachCorroborations } from '../services/corroboration.js';
import { normalise } from '../services/documents.js';
import { similarText } from '../services/similarity.js';
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
  occurred_at: string | null;
  confidentiality: Confidentiality | null;
  created_at: string;
  sources?:
    | { title: string; kind?: SourceKind; confidentiality?: Confidentiality }
    | { title: string; kind?: SourceKind; confidentiality?: Confidentiality }[]
    | null;
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
    source_kind: (embedded?.kind as SourceKind) ?? 'document',
    confidentiality: (embedded?.confidentiality as Confidentiality) ?? 'internal',
    occurred_at: raw.occurred_at,
    corroborations: [],
    created_at: raw.created_at,
  };
}

async function loadClaims(projectId: string): Promise<Claim[]> {
  const { data, error } = await serviceClient()
    .from(Tables.claims)
    .select('*, sources(title, kind, confidentiality)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new HttpError(500, error.message);
  return attachCorroborations((data ?? []).map((row) => toClaim(row as RawClaim)));
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
    source_kind: claim.source_kind,
    confidentiality: claim.confidentiality,
    occurred_at: claim.occurred_at,
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

    const { sections: visible, hidden_claim_count } = scopedSections(
      await withCurrentTiers(handover.snapshot?.sections ?? []),
      membership.scope,
    );

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
      hidden_claim_count,
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

// ---------------------------------------------------------------------------
// Version comparison and rollback
// ---------------------------------------------------------------------------

function flatten(sections: HandoverSection[]): Map<string, HandoverClaim> {
  const map = new Map<string, HandoverClaim>();
  for (const section of sections) {
    for (const claim of section.claims) map.set(claim.id, claim);
  }
  return map;
}

router.get(
  '/handovers/:handoverId/diff/:otherHandoverId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const to = await loadHandover(String(req.params.handoverId));
    const from = await loadHandover(String(req.params.otherHandoverId));
    await loadMembership(profile.id, to.project_id);
    if (from.project_id !== to.project_id) throw new HttpError(400, 'Those versions belong to different projects');

    const fromClaims = flatten(from.snapshot?.sections ?? []);
    const toClaims = flatten(to.snapshot?.sections ?? []);

    // A refreshed extraction regenerates claim ids, so identity cannot be the
    // comparison key: the same statement must count as unchanged even when it
    // arrives with a new row. Statements are matched by normalised text first,
    // then by strong subject overlap (reported as rewritten).
    const key = (text: string) => normalise(text);
    const fromByText = new Map([...fromClaims.values()].map((claim) => [key(claim.text), claim]));
    const toByText = new Map([...toClaims.values()].map((claim) => [key(claim.text), claim]));

    const addedClaims = [...toClaims.values()].filter((claim) => !fromByText.has(key(claim.text)));
    const removedClaims = [...fromClaims.values()].filter((claim) => !toByText.has(key(claim.text)));

    const changed: HandoverDiff['changed'] = [];
    const rewritten = new Set<string>();
    const rewrittenFrom = new Set<string>();
    for (const claim of addedClaims) {
      const candidate = removedClaims.find(
        (before) =>
          !rewrittenFrom.has(before.id) &&
          before.category === claim.category &&
          similarText(before.text, claim.text) >= 0.7,
      );
      if (!candidate) continue;
      rewritten.add(claim.id);
      rewrittenFrom.add(candidate.id);
      changed.push({
        id: claim.id,
        category: claim.category,
        from_text: candidate.text,
        to_text: claim.text,
        evidence: claim.evidence,
      });
    }

    const added = addedClaims.filter((claim) => !rewritten.has(claim.id));
    const removed = removedClaims.filter((claim) => !rewrittenFrom.has(claim.id));
    const unchanged = [...toClaims.values()].filter((claim) => fromByText.has(key(claim.text))).length;

    const diff: HandoverDiff = {
      from: { id: from.id, version: from.version, approved_at: from.approved_at },
      to: { id: to.id, version: to.version, approved_at: to.approved_at },
      added: added.map((claim) => ({
        id: claim.id,
        category: claim.category,
        text: claim.text,
        evidence: claim.evidence,
        source_kind: claim.source_kind,
      })),
      removed: removed.map((claim) => ({
        id: claim.id,
        category: claim.category,
        text: claim.text,
        evidence: claim.evidence,
        source_kind: claim.source_kind,
      })),
      changed,
      unchanged,
    };
    res.json({ diff });
  }),
);

/** Restore an earlier approved version as a new approval on top of history. */
router.post(
  '/handovers/:handoverId/rollback',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const source = await loadHandover(String(req.params.handoverId));
    const membership = await loadMembership(profile.id, source.project_id);
    if (membership.role !== 'manager') throw new HttpError(403, 'Only the project manager can restore a version');
    if (!source.snapshot?.sections?.length) throw new HttpError(409, 'That version has no approved content');

    const db = serviceClient();
    const { data: latest } = await db
      .from(Tables.handovers)
      .select('version')
      .eq('project_id', source.project_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = ((latest?.version as number | undefined) ?? 0) + 1;

    await db
      .from(Tables.handovers)
      .update({ status: 'superseded' })
      .eq('project_id', source.project_id)
      .eq('status', 'approved');

    // Also retire any open draft so the restored version is the live one.
    await db
      .from(Tables.handovers)
      .update({ status: 'rejected' })
      .eq('project_id', source.project_id)
      .eq('status', 'draft');

    const { data: created, error } = await db
      .from(Tables.handovers)
      .insert({
        project_id: source.project_id,
        version,
        status: 'approved',
        note: `Restored from v${source.version}`,
        snapshot: source.snapshot,
        created_by: profile.id,
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(source.project_id, profile.id, 'handover.rolled_back', 'handover', created.id as string, {
      restored_from: source.version,
      version,
    });
    res.status(201).json({ handover: created });
  }),
);

// ---------------------------------------------------------------------------
// Delivered handover: expiring signed links
// ---------------------------------------------------------------------------

interface DeliveryRow {
  id: string;
  handover_id: string;
  project_id: string;
  token: string;
  scope: RecipientScope;
  recipient_label: string | null;
  expires_at: string;
  revoked_at: string | null;
  opened_at: string | null;
  open_count: number;
  created_at: string;
}

interface DeliveryAckRow {
  link_id: string;
  name: string;
  email: string | null;
  acknowledged_at: string;
}

function deliveryStatus(row: DeliveryRow, now: number): DeliveryStatus {
  if (row.revoked_at) return 'revoked';
  return new Date(row.expires_at).getTime() <= now ? 'expired' : 'active';
}

function toDeliveryLink(row: DeliveryRow, ack: DeliveryAckRow | undefined): DeliveryLink {
  const now = Date.now();
  const status = deliveryStatus(row, now);
  return {
    id: row.id,
    handover_id: row.handover_id,
    project_id: row.project_id,
    scope: row.scope,
    recipient_label: row.recipient_label,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    opened_at: row.opened_at,
    open_count: row.open_count,
    created_at: row.created_at,
    status,
    url: status === 'active' ? `${config.webOrigin}/#/delivery/${row.token}` : null,
    token: status === 'active' ? row.token : null,
    acknowledgement: ack
      ? { name: ack.name, email: ack.email, acknowledged_at: ack.acknowledged_at }
      : null,
    needs_reminder: status === 'active' && !ack,
  };
}

const createDelivery = z.object({
  scope: z.enum(RECIPIENT_SCOPES),
  days: z.coerce.number().int().min(1).max(90).default(7),
  recipient_label: z.string().max(120).optional(),
});

router.get(
  '/handovers/:handoverId/deliveries',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const handover = await loadHandover(String(req.params.handoverId));
    const membership = await loadMembership(profile.id, handover.project_id);
    if (!['manager', 'reviewer'].includes(membership.role)) {
      throw new HttpError(403, 'Only a manager or reviewer can see delivery links');
    }

    const db = serviceClient();
    const { data: links, error } = await db
      .from(Tables.deliveryLinks)
      .select('*')
      .eq('handover_id', handover.id)
      .order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);

    const ids = (links ?? []).map((row) => row.id as string);
    const { data: acks } = ids.length
      ? await db.from(Tables.deliveryAcknowledgements).select('*').in('link_id', ids)
      : { data: [] as DeliveryAckRow[] };
    const ackByLink = new Map((acks ?? []).map((ack) => [ack.link_id as string, ack as DeliveryAckRow]));

    const out = ((links ?? []) as DeliveryRow[]).map((row) => toDeliveryLink(row, ackByLink.get(row.id)));
    res.json({ deliveries: out });
  }),
);

router.post(
  '/handovers/:handoverId/deliveries',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const handover = await loadHandover(String(req.params.handoverId));
    const membership = await loadMembership(profile.id, handover.project_id);
    if (!['manager', 'reviewer'].includes(membership.role)) {
      throw new HttpError(403, 'Only a manager or reviewer can create a delivery link');
    }
    if (handover.status !== 'approved') throw new HttpError(409, 'Approve the handover before delivering it');

    const body = createDelivery.safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, 'Choose a scope and an expiry between 1 and 90 days');

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + body.data.days * 24 * 60 * 60 * 1000).toISOString();
    const { data: created, error } = await serviceClient()
      .from(Tables.deliveryLinks)
      .insert({
        handover_id: handover.id,
        project_id: handover.project_id,
        token,
        scope: body.data.scope,
        recipient_label: body.data.recipient_label ?? null,
        expires_at: expiresAt,
        created_by: profile.id,
      })
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(handover.project_id, profile.id, 'delivery.link_created', 'delivery_link', created.id as string, {
      scope: body.data.scope,
      days: body.data.days,
      expires_at: expiresAt,
    });
    res.status(201).json({ delivery: toDeliveryLink(created as DeliveryRow, undefined) });
  }),
);

router.post(
  '/deliveries/:linkId/revoke',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const db = serviceClient();
    const { data: row } = await db
      .from(Tables.deliveryLinks)
      .select('*')
      .eq('id', req.params.linkId)
      .maybeSingle();
    if (!row) throw new HttpError(404, 'Delivery link not found');
    const membership = await loadMembership(profile.id, row.project_id as string);
    if (membership.role !== 'manager') throw new HttpError(403, 'Only the project manager can revoke a link');

    const { data: updated, error } = await db
      .from(Tables.deliveryLinks)
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(row.project_id as string, profile.id, 'delivery.link_revoked', 'delivery_link', row.id as string, null);
    res.json({ delivery: toDeliveryLink(updated as DeliveryRow, undefined) });
  }),
);

router.post(
  '/deliveries/:linkId/remind',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const db = serviceClient();
    const { data: row } = await db
      .from(Tables.deliveryLinks)
      .select('*')
      .eq('id', req.params.linkId)
      .maybeSingle();
    if (!row) throw new HttpError(404, 'Delivery link not found');
    const membership = await loadMembership(profile.id, row.project_id as string);
    if (!['manager', 'reviewer'].includes(membership.role)) {
      throw new HttpError(403, 'Only a manager or reviewer can send a reminder');
    }

    const link = row as DeliveryRow;
    if (deliveryStatus(link, Date.now()) !== 'active') {
      throw new HttpError(409, 'That link is no longer active');
    }
    const { data: ack } = await db
      .from(Tables.deliveryAcknowledgements)
      .select('*')
      .eq('link_id', link.id)
      .maybeSingle();
    if (ack) throw new HttpError(409, 'That recipient has already acknowledged the handover');

    await audit(link.project_id, profile.id, 'delivery.reminder', 'delivery_link', link.id, {
      recipient: link.recipient_label,
    });
    res.json({ delivery: toDeliveryLink(link, undefined) });
  }),
);

export default router;
