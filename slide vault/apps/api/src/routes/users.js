/**
 * User administration: changing a role and setting a temporary password.
 *
 * Both are administrator-only and both are audited. There is no email in this
 * deployment, so "forgot my password" is answered by an administrator setting
 * a temporary one here and telling the person out of band; doing so signs that
 * person out everywhere, so a password someone else may know stops working at
 * once.
 */
import { Router } from 'express';
import { ROLE_VALUES } from '@slidesvault/shared';
import { asyncHandler, badRequest, notFound } from '../http/errors.js';
import { clientIp, requireAdmin } from '../http/auth.js';
import { requireOneOf, requireString, requireUuid } from '../http/validate.js';
import { UserRepository } from '../db/repositories/userRepository.js';
import { AUDIT } from '../services/audit/AuditService.js';

/** The same floor self-registration enforces. */
export const MIN_PASSWORD_LENGTH = 10;

export function createUsersRouter({ users, sessions, audit }) {
  const router = Router();
  router.use(requireAdmin);

  const loadTarget = async (req) => {
    const target = await users.findById(requireUuid(req.params.id, 'id'));
    if (!target) throw notFound('No such user.');
    return target;
  };

  /** Changes a user's role. The only field this accepts is `role`. */
  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const target = await loadTarget(req);
      const role = requireOneOf(req.body?.role, 'role', ROLE_VALUES);

      if (target.role === role) {
        res.json({ user: UserRepository.sanitize(target), changed: false });
        return;
      }

      const changed = await users.changeRoleKeepingAnAdmin(target.id, role);
      if (!changed) {
        await audit.record({
          actorId: req.user.id,
          actorEmail: req.user.email,
          action: AUDIT.USER_ROLE_CHANGED,
          target: target.email,
          outcome: 'failure',
          ip: clientIp(req),
          details: { from: target.role, to: role, reason: 'last_admin' },
        });
        res.status(409).json({
          error: 'This is the last administrator. Promote someone else before changing this role.',
          code: 'last_admin',
        });
        return;
      }

      await audit.record({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: AUDIT.USER_ROLE_CHANGED,
        target: target.email,
        ip: clientIp(req),
        details: { userId: target.id, from: target.role, to: role },
      });
      res.json({ user: UserRepository.sanitize(await users.findById(target.id)), changed: true });
    })
  );

  /**
   * Sets a temporary password chosen by an administrator, and signs the user
   * out of every session they had.
   */
  router.post(
    '/:id/password',
    asyncHandler(async (req, res) => {
      const target = await loadTarget(req);
      const password = requireString(req.body?.password, 'password', { maxLength: 200 });
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw badRequest(`A temporary password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
      }

      await users.setPassword(target.id, password);
      await sessions.revokeAllForUser(target.id);

      await audit.record({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: AUDIT.USER_PASSWORD_SET,
        target: target.email,
        ip: clientIp(req),
        // Never the password itself — only that it was set and that sessions ended.
        details: { userId: target.id, sessionsRevoked: true },
      });
      res.json({ ok: true, sessions_revoked: true });
    })
  );

  return router;
}
