import { NextFunction, Request, Response } from 'express';
import { MemberRole, Profile } from '@knowbridge/shared';
import { serviceClient, Tables } from './db.js';

export interface AuthedRequest extends Request {
  profile?: Profile;
  token?: string;
}

/** Express error with HTTP status. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function asyncHandler(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthedRequest, res, next).catch(next);
  };
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Missing Bearer token'));
  req.token = token;
  serviceClient()
    .auth.getUser(token)
    .then(({ data, error }) => {
      if (error || !data.user) return next(new HttpError(401, 'Invalid or expired session'));
      req.profile = {
        id: data.user.id,
        email: data.user.email ?? '',
        display_name:
          (data.user.user_metadata?.display_name as string | undefined) ??
          (data.user.email ?? '').split('@')[0],
        created_at: data.user.created_at ?? '',
      };
      next();
    })
    .catch(() => next(new HttpError(401, 'Invalid session')));
}

/** Membership result attached to request by project guard. */
export interface MembershipGuard extends AuthedRequest {
  project_id?: string;
  memberRole?: MemberRole;
}

/**
 * Guard: the caller must be a member of req project (param id) with one of
 * the allowed roles. Used with `:projectId` or `:id` path params.
 */
export function requireMember(paramName: 'projectId' | 'id' = 'projectId', roles?: MemberRole[]) {
  return (req: MembershipGuard, _res: Response, next: NextFunction) => {
    const projectId = String(req.params[paramName] ?? '');
    if (!projectId) return next(new HttpError(400, 'Missing project id'));
    serviceClient()
      .from(Tables.projectMembers)
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', req.profile!.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return next(new HttpError(500, 'Membership lookup failed'));
        if (!data) return next(new HttpError(403, 'You are not a member of this project'));
        const role = data.role as MemberRole;
        if (roles && !roles.includes(role)) {
          return next(new HttpError(403, `Requires role: ${roles.join(' or ')}`));
        }
        req.project_id = projectId;
        req.memberRole = role;
        next();
      });
  };
}

export async function audit(
  projectId: string,
  actor: { id: string; email: string },
  action: string,
  detail: Record<string, unknown> = {},
) {
  await serviceClient()
    .from(Tables.auditLog)
    .insert({ project_id: projectId, actor_id: actor.id, actor_email: actor.email, action, detail });
}
