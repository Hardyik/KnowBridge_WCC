/**
 * Projects & members + current-user endpoints.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { Profile, Project, ProjectMember, MemberRole } from '@knowbridge/shared';
import { AuthedRequest, asyncHandler, HttpError, audit, requireMember, requireAuth } from '../auth.js';
import { serviceClient, Tables } from '../db.js';

const router = Router();

interface MemberRow {
  id: string;
  project_id: string;
  user_id: string;
  role: MemberRole;
  // Supabase returns an object or (in client typing) an array for nested selects.
  profiles?:
    | { email: string; display_name: string }
    | Array<{ email: string; display_name: string }>
    | null;
  created_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ profile: (req as AuthedRequest).profile });
  }),
);

router.get(
  '/projects',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).profile!;
    const memberships = (await serviceClient()
      .from(Tables.projectMembers)
      .select('role, project_id')
      .eq('user_id', user.id)) as { data: Array<{ role: MemberRole; project_id: string }> | null };
    if (!memberships.data || memberships.data.length === 0) return res.json({ projects: [] });

    const ids = memberships.data.map((m) => m.project_id);
    const { data: projects } = await serviceClient()
      .from(Tables.projects)
      .select('*')
      .in('id', ids);
    const byId = new Map((projects ?? []).map((p) => [p.id, p as ProjectRow]));
    const result = memberships.data
      .filter((m) => byId.has(m.project_id))
      .map((m) => ({
        ...(byId.get(m.project_id) as unknown as Project),
        my_role: m.role,
      }));
    res.json({ projects: result });
  }),
);

const CreateProject = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

router.post(
  '/projects',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).profile!;
    const body = CreateProject.parse(req.body);
    const db = serviceClient();
    const { data: project, error } = await db
      .from(Tables.projects)
      .insert({ name: body.name, description: body.description ?? null, owner_id: user.id })
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message);
    // Creator becomes manager automatically.
    await db.from(Tables.projectMembers).insert({
      project_id: project.id,
      user_id: user.id,
      role: 'manager',
    });
    await audit(project.id, user, 'project.create', { name: body.name });
    res.status(201).json({ project });
  }),
);

router.get(
  '/projects/:projectId',
  requireMember('projectId'),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const projectId = req.params.projectId;
    const db = serviceClient();
    const { data: project } = await db.from(Tables.projects).select('*').eq('id', projectId).single();
    if (!project) throw new HttpError(404, 'Project not found');
    const { data: members } = await db
      .from(Tables.projectMembers)
      .select('id, project_id, user_id, role, created_at, profiles(email, display_name)')
      .eq('project_id', projectId);
    res.json({
      project,
      members: (members ?? []).map((mRaw) => {
        const m = mRaw as MemberRow;
        const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return {
          id: m.id,
          project_id: m.project_id,
          user_id: m.user_id,
          role: m.role,
          email: prof?.email ?? null,
          display_name: prof?.display_name ?? null,
          created_at: m.created_at,
        };
      }),
    });
  }),
);

const AddMember = z.object({
  user_id: z.string().uuid().optional(),
  email: z.string().email().optional(),
  role: z.enum(['manager', 'reviewer', 'recipient']),
});

router.post(
  '/projects/:projectId/members',
  requireMember('projectId', ['manager']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const projectId = req.params.projectId!;
    const body = AddMember.parse(req.body);
    const db = serviceClient();

    let userId = body.user_id;
    if (!userId && body.email) {
      // Invite by email (user must exist in this Supabase instance).
      const { data: profile } = await db
        .from(Tables.profiles)
        .select('id')
        .eq('email', body.email.toLowerCase())
        .single();
      if (!profile) throw new HttpError(404, 'No user registered with that email');
      userId = profile.id;
    }
    if (!userId) throw new HttpError(400, 'Provide user_id or email');

    const { data: member, error } = await db
      .from(Tables.projectMembers)
      .insert({ project_id: projectId, user_id: userId, role: body.role })
      .select('*')
      .single();
    if (error) throw new HttpError(error.code === '23505' ? 409 : 400, error.message);
    await audit(projectId, req.profile!, 'member.add', { user_id: userId, role: body.role });
    res.status(201).json({ member });
  }),
);

router.get(
  '/users/lookup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 3) return res.json({ users: [] });
    const { data } = await serviceClient()
      .from(Tables.profiles)
      .select('id, email, display_name')
      .ilike('email', `%${q}%`)
      .limit(10);
    res.json({ users: data ?? [] as unknown as Profile[] });
  }),
);

export default router;
