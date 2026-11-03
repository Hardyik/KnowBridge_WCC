import { Router } from 'express';
import { z } from 'zod';
import {
  MemberRole,
  MEMBER_ROLES,
  ProjectMember,
  ProjectSummary,
  RecipientScope,
  RECIPIENT_SCOPES,
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

const createProject = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(600).default(''),
});

const addMember = z.object({
  email: z.string().email(),
  role: z.enum(MEMBER_ROLES),
  scope: z.enum(RECIPIENT_SCOPES).optional(),
});

const updateMember = z.object({
  role: z.enum(MEMBER_ROLES).optional(),
  scope: z.enum(RECIPIENT_SCOPES).optional(),
});

router.get(
  '/projects',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { profile } = req as AuthedRequest;
    const db = serviceClient();

    const { data: memberships } = await db
      .from(Tables.projectMembers)
      .select('project_id, role, scope')
      .eq('user_id', profile.id);
    if (!memberships?.length) return res.json({ projects: [] });

    const ids = memberships.map((m) => m.project_id);
    const [{ data: projects }, { data: sources }, { data: claims }, { data: handovers }] =
      await Promise.all([
        db.from(Tables.projects).select('*').in('id', ids),
        db.from(Tables.sources).select('project_id').in('project_id', ids),
        db.from(Tables.claims).select('project_id').in('project_id', ids),
        db
          .from(Tables.handovers)
          .select('id, project_id, version, approved_at, status')
          .in('project_id', ids)
          .eq('status', 'approved')
          .order('version', { ascending: false }),
      ]);

    const countBy = (rows: { project_id: string }[] | null) => {
      const map = new Map<string, number>();
      for (const row of rows ?? []) map.set(row.project_id, (map.get(row.project_id) ?? 0) + 1);
      return map;
    };
    const sourceCounts = countBy(sources);
    const claimCounts = countBy(claims);

    const approved = new Map<string, { id: string; version: number; approved_at: string }>();
    for (const h of handovers ?? []) {
      if (!approved.has(h.project_id)) {
        approved.set(h.project_id, {
          id: h.id as string,
          version: h.version as number,
          approved_at: h.approved_at as string,
        });
      }
    }

    const projects_out: ProjectSummary[] = (projects ?? [])
      .map((p) => {
        const membership = memberships.find((m) => m.project_id === p.id);
        return {
          id: p.id as string,
          name: p.name as string,
          description: (p.description as string) ?? '',
          owner_id: p.owner_id as string,
          created_at: p.created_at as string,
          role: (membership?.role ?? 'recipient') as MemberRole,
          scope: (membership?.scope ?? 'general') as RecipientScope,
          source_count: sourceCounts.get(p.id as string) ?? 0,
          claim_count: claimCounts.get(p.id as string) ?? 0,
          approved_handover: approved.get(p.id as string) ?? null,
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    res.json({ projects: projects_out });
  }),
);

router.post(
  '/projects',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = createProject.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'A project name is required');
    const { profile } = req as AuthedRequest;
    const db = serviceClient();

    const { data: project, error } = await db
      .from(Tables.projects)
      .insert({ name: body.data.name, description: body.data.description, owner_id: profile.id })
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    const { error: memberError } = await db.from(Tables.projectMembers).insert({
      project_id: project.id,
      user_id: profile.id,
      role: 'manager',
      scope: 'manager',
    });
    if (memberError) throw new HttpError(500, memberError.message);

    await audit(project.id, profile.id, 'project.created', 'project', project.id, {
      name: body.data.name,
    });
    res.status(201).json({ project });
  }),
);

router.get(
  '/projects/:projectId',
  requireMember(),
  asyncHandler(async (req, res) => {
    const { projectId } = req as MemberRequest;
    const db = serviceClient();

    const { data: project, error } = await db
      .from(Tables.projects)
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!project) throw new HttpError(404, 'Project not found');

    const { data: members } = await db
      .from(Tables.projectMembers)
      .select('id, project_id, user_id, role, scope, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    // project_members points at auth.users, so profiles are fetched separately.
    const userIds = (members ?? []).map((m) => m.user_id as string);
    const { data: profiles } = userIds.length
      ? await db.from(Tables.profiles).select('id, email, display_name').in('id', userIds)
      : { data: [] as { id: string; email: string; display_name: string }[] };
    const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

    const membersOut: ProjectMember[] = (members ?? []).map((m) => {
      const profile = byId.get(m.user_id as string);
      return {
        id: m.id as string,
        project_id: m.project_id as string,
        user_id: m.user_id as string,
        role: m.role as MemberRole,
        scope: m.scope as RecipientScope,
        email: (profile?.email as string) ?? null,
        display_name: (profile?.display_name as string) ?? null,
        created_at: m.created_at as string,
      };
    });

    const [{ count: sourceCount }, { count: claimCount }] = await Promise.all([
      db.from(Tables.sources).select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      db.from(Tables.claims).select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    ]);

    res.json({
      project,
      members: membersOut,
      my_role: (req as MemberRequest).membership.role,
      my_scope: (req as MemberRequest).membership.scope,
      counts: { sources: sourceCount ?? 0, claims: claimCount ?? 0 },
    });
  }),
);

router.post(
  '/projects/:projectId/members',
  requireMember('projectId', ['manager']),
  asyncHandler(async (req, res) => {
    const body = addMember.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'Email and role are required');
    const { projectId, profile } = req as MemberRequest;
    const db = serviceClient();

    const { data: target } = await db
      .from(Tables.profiles)
      .select('id, email, display_name')
      .eq('email', body.data.email)
      .maybeSingle();
    if (!target) {
      throw new HttpError(404, 'No KnowBridge account uses that email — ask them to sign up first');
    }

    const scope = body.data.scope ?? (body.data.role === 'recipient' ? 'general' : 'coordinator');
    const { data: existing } = await db
      .from(Tables.projectMembers)
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', target.id)
      .maybeSingle();
    if (existing) throw new HttpError(409, 'That person is already a member');

    const { data: member, error } = await db
      .from(Tables.projectMembers)
      .insert({ project_id: projectId, user_id: target.id, role: body.data.role, scope })
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(projectId, profile.id, 'member.added', 'member', member.id as string, {
      email: body.data.email,
      role: body.data.role,
      scope,
    });
    res.status(201).json({ member });
  }),
);

router.patch(
  '/projects/:projectId/members/:memberId',
  requireMember('projectId', ['manager']),
  asyncHandler(async (req, res) => {
    const body = updateMember.safeParse(req.body);
    if (!body.success || Object.keys(body.data).length === 0) {
      throw new HttpError(400, 'Send a role or a scope to change');
    }
    const { projectId, profile } = req as MemberRequest;
    const { data: updated, error } = await serviceClient()
      .from(Tables.projectMembers)
      .update(body.data)
      .eq('id', req.params.memberId)
      .eq('project_id', projectId)
      .select('*')
      .single();
    if (error) throw new HttpError(500, error.message);

    await audit(projectId, profile.id, 'member.updated', 'member', String(req.params.memberId), body.data);
    res.json({ member: updated });
  }),
);

router.delete(
  '/projects/:projectId/members/:memberId',
  requireMember('projectId', ['manager']),
  asyncHandler(async (req, res) => {
    const { projectId, profile } = req as MemberRequest;
    const { data: member } = await serviceClient()
      .from(Tables.projectMembers)
      .select('user_id')
      .eq('id', req.params.memberId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!member) throw new HttpError(404, 'Member not found');
    if (member.user_id === profile.id) throw new HttpError(400, 'You cannot remove yourself');

    const { error } = await serviceClient()
      .from(Tables.projectMembers)
      .delete()
      .eq('id', req.params.memberId)
      .eq('project_id', projectId);
    if (error) throw new HttpError(500, error.message);

    await audit(projectId, profile.id, 'member.removed', 'member', String(req.params.memberId), null);
    res.json({ ok: true });
  }),
);

router.get(
  '/projects/:projectId/audit',
  requireMember(),
  asyncHandler(async (req, res) => {
    const { projectId } = req as MemberRequest;
    const db = serviceClient();
    const { data: entries, error } = await db
      .from(Tables.auditLog)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new HttpError(500, error.message);

    const actorIds = [...new Set((entries ?? []).map((e) => e.actor_id as string).filter(Boolean))];
    const { data: actors } = actorIds.length
      ? await db.from(Tables.profiles).select('id, display_name, email').in('id', actorIds)
      : { data: [] as { id: string; display_name: string; email: string }[] };
    const names = new Map((actors ?? []).map((a) => [a.id as string, a.display_name as string]));

    res.json({
      entries: (entries ?? []).map((e) => ({
        ...e,
        actor_name: names.get(e.actor_id as string) ?? null,
      })),
    });
  }),
);

export default router;
