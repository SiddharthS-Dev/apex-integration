import { createClientFromRequest } from '@base44/sdk';
import { json, errorResponse } from '../../shared/dropboxClient.ts';

/** Writes a LoginHistory row and refreshes the user's last_login/last_active. */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) return json({ error: 'Authentication required.' }, 401);

    const now = new Date().toISOString();

    await base44.asServiceRole.entities.LoginHistory.create({
      user_id: user.id,
      user_name: user.full_name ?? '',
      email: user.email ?? '',
      login_at: now,
      status: 'success',
    });

    await base44.asServiceRole.entities.User.update(user.id, {
      last_login: now,
      last_active: now,
    });

    return json({ ok: true, login_at: now });
  } catch (err) {
    return errorResponse(err);
  }
});
