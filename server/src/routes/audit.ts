/** Project audit trail (manager/reviewer only). */
import { Router } from 'express';
import { requireMember } from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { AuthedRequest, asyncHandler } from '../auth.js';

const router = Router();

router.get(
  '/projects/:projectId/audit',
  requireMember('projectId', ['manager', 'reviewer']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data } = await serviceClient()
      .from(Tables.auditLog)
      .select('id, project_id, actor_id, actor_email, action, detail, created_at')
      .eq('project_id', req.params.projectId)
      .order('created_at', { ascending: false })
      .limit(200);
    res.json({ audit: data ?? [] });
  }),
);

export default router;
