import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AuthedRequest, HttpError, requireAuth } from '../auth.js';
import { anonClient, serviceClient, Tables } from '../db.js';

const router = Router();

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Use at least 8 characters'),
  display_name: z.string().min(1).max(60).optional(),
});

/**
 * Accounts are created with the service role and immediately confirmed, so a
 * judge can sign up and use the product without an email round-trip.
 */
router.post(
  '/auth/signup',
  asyncHandler(async (req, res) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? 'Invalid sign-up');

    const db = serviceClient();
    const { data, error } = await db.auth.admin.createUser({
      email: body.data.email,
      password: body.data.password,
      email_confirm: true,
      user_metadata: { display_name: body.data.display_name ?? body.data.email.split('@')[0] },
    });
    if (error) {
      const taken = /already|exists|registered/i.test(error.message);
      throw new HttpError(taken ? 409 : 400, taken ? 'That email is already registered' : error.message);
    }
    if (!data.user) throw new HttpError(500, 'Account creation returned no user');

    await db.from(Tables.profiles).upsert({
      id: data.user.id,
      email: body.data.email,
      display_name: body.data.display_name ?? body.data.email.split('@')[0],
    });

    const session = await anonClient().auth.signInWithPassword({
      email: body.data.email,
      password: body.data.password,
    });
    if (session.error || !session.data.session) {
      throw new HttpError(500, session.error?.message ?? 'Could not start a session');
    }
    res.status(201).json({
      token: session.data.session.access_token,
      profile: {
        id: data.user.id,
        email: body.data.email,
        display_name: body.data.display_name ?? body.data.email.split('@')[0],
      },
    });
  }),
);

router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const body = credentials.omit({ display_name: true }).safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'Email and password are required');

    const session = await anonClient().auth.signInWithPassword({
      email: body.data.email,
      password: body.data.password,
    });
    if (session.error || !session.data.session || !session.data.user) {
      throw new HttpError(401, 'Email or password is incorrect');
    }

    const { data: profile } = await serviceClient()
      .from(Tables.profiles)
      .select('id, email, display_name')
      .eq('id', session.data.user.id)
      .maybeSingle();

    res.json({
      token: session.data.session.access_token,
      profile:
        profile ??
        {
          id: session.data.user.id,
          email: body.data.email,
          display_name: body.data.email.split('@')[0],
        },
    });
  }),
);

router.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ profile: (req as AuthedRequest).profile });
  }),
);

export default router;
