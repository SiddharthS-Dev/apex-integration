/**
 * /api/entities — the catalog and what it says about itself.
 *
 *   GET   /plates               the active library, as plate records
 *   GET   /plates/:id
 *   POST  /plates/:id/events    view / download / favourite / offline
 *   PATCH /plates/:id           admin correction of title or classification
 *   GET   /analytics            dashboard aggregates
 *   GET   /sync-logs            admin
 *   GET   /login-history        admin
 */
import express from 'express'
import { CATEGORY_NAMES, PRODUCTS, TECHS } from '@inspironics/shared'
import { badRequest, intParam, notFound, route } from '../lib/http.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import { EVENT_KINDS, toPlate } from '../repos/files.js'

const EDITABLE_TEXT = ['objective', 'architecture', 'takeaway']
const EDITABLE_LISTS = ['flow', 'components', 'bizben', 'techben', 'extraKeywords']

export function entityRoutes({ repos }) {
  const r = express.Router()

  r.get(
    '/plates',
    requireAuth,
    route(async (req, res) => {
      const rows = await repos.files.listActive()
      const items = rows.map(toPlate)
      res.setHeader('Cache-Control', 'private, no-cache')
      res.json({
        source: 'dropbox',
        total: items.length,
        items,
        flagship: items.filter((i) => i.flagship).map((i) => i.f),
        generatedAt: new Date().toISOString(),
      })
    })
  )

  r.get(
    '/plates/:id',
    requireAuth,
    route(async (req, res) => {
      const row = await repos.files.get(req.params.id)
      if (!row || (row.status !== 'active' && req.user.role !== 'admin')) throw notFound('No such plate.')
      res.json({ plate: toPlate(row), status: row.status, warnings: JSON.parse(row.warnings || '[]') })
    })
  )

  r.post(
    '/plates/:id/events',
    requireAuth,
    route(async (req, res) => {
      const kind = req.body?.kind
      if (!EVENT_KINDS.includes(kind)) throw badRequest(`kind must be one of ${EVENT_KINDS.join(', ')}.`)
      const row = await repos.files.get(req.params.id)
      if (!row) throw notFound('No such plate.')
      await repos.events.record(row.id, req.user.id, kind)
      if (kind === 'view') await repos.files.incrementViews(row.id)
      res.status(204).end()
    })
  )

  r.patch(
    '/plates/:id',
    requireAdmin,
    route(async (req, res) => {
      const body = req.body || {}
      const meta = {}
      if (body.cat !== undefined) {
        if (!CATEGORY_NAMES.includes(body.cat)) throw badRequest('Unknown category.')
        meta.cat = body.cat
        meta.tag = undefined
      }
      if (body.tech !== undefined) {
        if (!Array.isArray(body.tech) || body.tech.some((t) => !TECHS.includes(t))) throw badRequest('Unknown technology.')
        meta.tech = body.tech
      }
      if (body.products !== undefined) {
        if (!Array.isArray(body.products) || body.products.some((p) => !PRODUCTS.some((x) => x.key === p))) throw badRequest('Unknown product.')
        meta.products = body.products
      }
      for (const k of ['esg', 'ai', 'iot', 'flagship']) if (body[k] !== undefined) meta[k] = !!body[k]
      for (const k of EDITABLE_TEXT) if (body[k] !== undefined) meta[k] = String(body[k]).slice(0, 1000)
      for (const k of EDITABLE_LISTS) {
        if (body[k] !== undefined) {
          if (!Array.isArray(body[k])) throw badRequest(`${k} must be a list.`)
          meta[k] = body[k].map((s) => String(s).slice(0, 120)).slice(0, 20)
        }
      }
      const title = body.title !== undefined ? String(body.title).trim().slice(0, 160) : undefined
      if (title !== undefined && title.length < 2) throw badRequest('Title is too short.')
      if (!(await repos.files.updateMeta(req.params.id, { title, meta }))) throw notFound('No such plate.')
      res.json({ plate: toPlate(await repos.files.get(req.params.id)) })
    })
  )

  r.get(
    '/analytics',
    requireAuth,
    route(async (req, res) => {
      const days = intParam(req.query.days, 30, { min: 1, max: 365 })
      const since = new Date(Date.now() - days * 86400_000).toISOString()
      const rows = await repos.files.listActive()
      const plates = rows.map(toPlate)

      const tally = (fn) => {
        const m = new Map()
        for (const p of plates) for (const k of [].concat(fn(p) || [])) m.set(k, (m.get(k) || 0) + 1)
        return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      }

      const [counts, events, syncs, topViewed, topDownloaded] = await Promise.all([
        repos.files.counts(),
        repos.events.byDay(since),
        repos.syncLog.list({ limit: 20 }),
        repos.events.top('view', 10),
        repos.events.top('download', 10),
      ])
      const admin = req.user.role === 'admin'

      res.json({
        library: {
          active: counts.active || 0,
          archived: counts.archived || 0,
          byCategory: tally((p) => p.cat),
          byTech: tally((p) => p.tech),
          byKind: tally((p) => p.ext),
          byClassification: tally((p) => p.classification),
          byTitleSource: tally((p) => p.titleSource),
          flags: { esg: plates.filter((p) => p.esg).length, ai: plates.filter((p) => p.ai).length, iot: plates.filter((p) => p.iot).length },
          totalBytes: plates.reduce((s, p) => s + p.size, 0),
        },
        activity: { days, byDay: events.map((e) => ({ day: e.day, kind: e.kind, count: Number(e.n) })) },
        topViewed: topViewed.map((t) => ({ id: t.file_id, title: t.title, count: Number(t.n) })),
        topDownloaded: topDownloaded.map((t) => ({ id: t.file_id, title: t.title, count: Number(t.n) })),
        syncHistory: syncs.items.map((s) => ({
          id: s.id,
          startedAt: s.startedAt,
          status: s.status,
          durationMs: s.durationMs,
          added: s.added,
          updated: s.updated,
          archived: s.archived,
          failed: s.failed,
        })),
        ...(admin && {
          logins: (await repos.events.loginsByDay(since)).map((l) => ({ day: l.day, success: !!l.success, count: Number(l.n) })),
        }),
      })
    })
  )

  r.get(
    '/sync-logs',
    requireAdmin,
    route(async (req, res) => {
      res.json(await repos.syncLog.list({ limit: intParam(req.query.limit, 25, { min: 1, max: 200 }), offset: intParam(req.query.offset, 0) }))
    })
  )

  r.get(
    '/login-history',
    requireAdmin,
    route(async (req, res) => {
      res.json(await repos.loginHistory.list({ limit: intParam(req.query.limit, 50, { min: 1, max: 500 }), offset: intParam(req.query.offset, 0) }))
    })
  )

  return r
}
