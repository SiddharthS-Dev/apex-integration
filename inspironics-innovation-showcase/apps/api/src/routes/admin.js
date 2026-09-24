/**
 * /api/admin — people, metrics, the object cache and config health.
 */
import express from 'express'
import { ALL_ROLES, ROLES } from '@inspironics/shared'
import { HttpError, badRequest, notFound, route } from '../lib/http.js'
import { requireAdmin } from '../middleware/auth.js'
import { toUser } from '../repos/auth.js'

export function adminRoutes({ config, repos, store, metrics }) {
  const r = express.Router()
  r.use(requireAdmin)

  r.get(
    '/users',
    route(async (req, res) => {
      res.json({ items: (await repos.users.list()).map(toUser) })
    })
  )

  r.patch(
    '/users/:id',
    route(async (req, res) => {
      const target = await repos.users.findById(req.params.id)
      if (!target || target.role === ROLES.GUEST) throw notFound('No such user.')
      const patch = {}
      if (req.body?.role !== undefined) {
        if (!ALL_ROLES.includes(req.body.role) || req.body.role === ROLES.GUEST) throw badRequest('Unknown role.')
        patch.role = req.body.role
      }
      if (req.body?.disabled !== undefined) patch.disabled = !!req.body.disabled

      const losesAdmin = target.role === ROLES.ADMIN && ((patch.role && patch.role !== ROLES.ADMIN) || patch.disabled)
      if (losesAdmin && (await repos.users.countAdmins()) <= 1) throw new HttpError(409, 'There must always be at least one active administrator.')
      if (target.id === req.user.id && patch.disabled) throw badRequest('You cannot disable your own account.')

      await repos.users.update(target.id, patch)
      if (patch.disabled || patch.role) await repos.sessions.revokeForUser(target.id)
      res.json({ user: toUser(await repos.users.findById(target.id)) })
    })
  )

  r.get('/metrics', (req, res) => {
    if (req.query.format === 'prometheus') return res.type('text/plain; version=0.0.4').send(metrics.prometheus())
    res.json(metrics.snapshot())
  })

  r.get(
    '/cache',
    route(async (req, res) => res.json(await store.stats()))
  )

  r.delete(
    '/cache',
    route(async (req, res) => {
      await store.clear()
      res.json({ ok: true })
    })
  )

  r.get('/config', (req, res) => {
    res.json({
      nodeEnv: config.nodeEnv,
      database: config.db.url ? 'postgres' : 'sqlite',
      problems: config.problems,
      sync: { enabled: config.sync.enabled, intervalMinutes: config.sync.intervalMinutes, concurrency: config.sync.concurrency, maxExtractMb: config.sync.maxExtractMb },
      ai: { enabled: config.ai.enabled, model: config.ai.model },
      auth: { allowRegistration: config.auth.allowRegistration, guestEnabled: config.auth.guestEnabled, google: !!config.auth.googleClientId },
    })
  })

  return r
}
