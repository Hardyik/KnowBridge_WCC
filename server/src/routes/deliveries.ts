/**
 * Public delivery surface.
 *
 * A manager creates an expiring, signed link; the recipient opens it without a
 * KnowBridge account. The link carries a fixed scope chosen by the manager, and
 * the same scope + confidentiality filtering applies as in the signed-in view,
 * so a link cannot show more than its scope allows.
 */

import { Router } from 'express';
import { z } from 'zod';
import { DeliveryView, RecipientScope } from '@knowbridge/shared';
import { asyncHandler, audit, HttpError } from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { scopedSections, withCurrentTiers } from '../services/scoping.js';

const router = Router();

interface LinkRow {
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

interface HandoverRow {
  id: string;
  project_id: string;
  version: number;
  status: string;
  note: string | null;
  snapshot: { sections: import('@knowbridge/shared').HandoverSection[] } | null;
  approved_at: string | null;
}

async function loadActiveLink(token: string): Promise<LinkRow> {
  const { data, error } = await serviceClient()
    .from(Tables.deliveryLinks)
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'This handover link does not exist');
  const link = data as LinkRow;
  if (link.revoked_at) throw new HttpError(410, 'This handover link was revoked by the project manager');
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    throw new HttpError(410, 'This handover link has expired — ask the project manager for a new one');
  }
  return link;
}

router.get(
  '/delivery/:token',
  asyncHandler(async (req, res) => {
    const db = serviceClient();
    const link = await loadActiveLink(String(req.params.token));

    const { data: handoverRow, error } = await db
      .from(Tables.handovers)
      .select('id, project_id, version, status, note, snapshot, approved_at')
      .eq('id', link.handover_id)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!handoverRow) throw new HttpError(404, 'The handover behind this link no longer exists');
    const handover = handoverRow as HandoverRow;

    const { data: project } = await db
      .from(Tables.projects)
      .select('id, name, description')
      .eq('id', handover.project_id)
      .maybeSingle();

    const { sections, hidden_claim_count } = scopedSections(
      await withCurrentTiers(handover.snapshot?.sections ?? []),
      link.scope,
    );

    const { data: ack } = await db
      .from(Tables.deliveryAcknowledgements)
      .select('name, email, acknowledged_at')
      .eq('link_id', link.id)
      .maybeSingle();

    if (!ack) {
      await db
        .from(Tables.deliveryLinks)
        .update({
          opened_at: link.opened_at ?? new Date().toISOString(),
          open_count: link.open_count + 1,
        })
        .eq('id', link.id);
    }

    await audit(handover.project_id, null, 'delivery.opened', 'delivery_link', link.id, {
      scope: link.scope,
      version: handover.version,
    });

    const view: DeliveryView = {
      delivery: {
        scope: link.scope,
        recipient_label: link.recipient_label,
        expires_at: link.expires_at,
      },
      handover: {
        id: handover.id,
        version: handover.version,
        approved_at: handover.approved_at,
        status: handover.status,
      },
      project: {
        id: (project?.id as string) ?? handover.project_id,
        name: (project?.name as string) ?? 'Project',
        description: (project?.description as string) ?? '',
      },
      sections,
      hidden_claim_count,
      scope_note:
        'This link was issued for a fixed scope by the project manager. Sections outside it and confidential sources are not included.',
      acknowledged_at: (ack?.acknowledged_at as string) ?? null,
      reviewer_note: handover.note,
    };
    res.json(view);
  }),
);

const acknowledgeBody = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200).optional(),
});

router.post(
  '/delivery/:token/acknowledge',
  asyncHandler(async (req, res) => {
    const link = await loadActiveLink(String(req.params.token));
    const body = acknowledgeBody.safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, 'Enter the name of the person receiving this handover');

    const db = serviceClient();
    const { data: existing } = await db
      .from(Tables.deliveryAcknowledgements)
      .select('name, email, acknowledged_at')
      .eq('link_id', link.id)
      .maybeSingle();
    if (existing) {
      return res.json({ acknowledgement: existing, already: true });
    }

    const { data: created, error } = await db
      .from(Tables.deliveryAcknowledgements)
      .insert({
        link_id: link.id,
        name: body.data.name.trim(),
        email: body.data.email ?? null,
      })
      .select('name, email, acknowledged_at')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(link.project_id, null, 'delivery.acknowledged', 'delivery_link', link.id, {
      name: body.data.name.trim(),
      version: link.handover_id,
    });
    res.status(201).json({ acknowledgement: created });
  }),
);

export default router;
