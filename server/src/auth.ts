import { NextFunction, Request, RequestHandler, Response } from 'express';
import { MemberRole, Profile, RecipientScope } from '@knowbridge/shared';
import { serviceClient, Tables } from './db.js';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AuthedRequest extends Request {
  profile: Profile;
  accessToken: string;
}

export interface MemberRequest extends AuthedRequest {
  projectId: string;
  membership: { role: MemberRole; scope: RecipientScope };
}

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Express 4 does not forward rejected promises; this does. */
export function asyncHandler(fn: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}

/**
 * Resolve the bearer token to a profile. The profile row is created on first
 * sight so a user provisioned directly in Supabase still works.
 */
export async function resolveProfile(token: string): Promise<Profile> {
  const db = serviceClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Invalid or expired session');

  const user = data.user;
  const email = user.email ?? `${user.id}@unknown.local`;

  const { data: existing } = await db
    .from(Tables.profiles)
    .select('id, email, display_name')
    .eq('id', user.id)
    .maybeSingle();
  if (existing) return existing as Profile;

  const displayName =
    (user.user_metadata?.display_name as string | undefined) ?? email.split('@')[0] ?? 'Member';
  const { data: created, error: insertError } = await db
    .from(Tables.profiles)
    .insert({ id: user.id, email, display_name: displayName })
    .select('id, email, display_name')
    .single();
  if (insertError) throw new HttpError(500, `Could not create profile: ${insertError.message}`);
  return created as Profile;
}

/** Attach req.profile and req.accessToken, or 401. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) throw new HttpError(401, 'Missing bearer token');
      const profile = await resolveProfile(token);
      const authed = req as AuthedRequest;
      authed.profile = profile;
      authed.accessToken = token;
      next();
    } catch (err) {
      next(err);
    }
  })();
};

/**
 * Authenticated member of :projectId. Returning [requireAuth, guard] means a
 * route can never accidentally check membership without a session.
 */
export function requireMember(
  paramName: 'projectId' | 'id' = 'projectId',
  roles?: MemberRole[],
): RequestHandler[] {
  const guard: RequestHandler = (req, _res, next) => {
    void (async () => {
      try {
        const projectId = String(req.params[paramName] ?? '');
        if (!projectId) throw new HttpError(400, 'Missing project id');
        const authed = req as MemberRequest;
        const { data, error } = await serviceClient()
          .from(Tables.projectMembers)
          .select('role, scope')
          .eq('project_id', projectId)
          .eq('user_id', authed.profile.id)
          .maybeSingle();
        if (error) throw new HttpError(500, error.message);
        if (!data) throw new HttpError(403, 'You are not a member of this project');
        const membership = data as { role: MemberRole; scope: RecipientScope };
        if (roles && !roles.includes(membership.role)) {
          throw new HttpError(403, `Requires role: ${roles.join(' or ')}`);
        }
        authed.projectId = projectId;
        authed.membership = membership;
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
  return [requireAuth, guard];
}

/** Append to the project audit trail. Never blocks the main action. */
export async function audit(
  projectId: string,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: Record<string, unknown> | null = null,
): Promise<void> {
  try {
    await serviceClient().from(Tables.auditLog).insert({
      project_id: projectId,
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      detail,
    });
  } catch (err) {
    console.warn('audit write failed', err);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Unexpected error';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
}
