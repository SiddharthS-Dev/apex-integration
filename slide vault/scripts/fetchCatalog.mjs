/**
 * Pulls the live presentation catalog out of the Base44 app and writes it to
 * src/api/catalog.json, which the local backend seeds from.
 *
 *   npm run sync:catalog
 *   npm run sync:catalog -- --app-id <id>
 *
 * Why this exists: the local backend used to seed a hand-written demo catalog
 * of 32 decks, so the app showed 32 while Base44 held 190. Rather than keep two
 * catalogs in step by hand, the real one is fetched and committed. Re-run this
 * whenever the Base44 library changes.
 *
 * The entity endpoint is readable without a key, so this needs no credentials.
 * Nothing here runs in the browser — it is a build-time fetch.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'src', 'api', 'catalog.json')

const argApp = process.argv.indexOf('--app-id')
const APP_ID =
  (argApp !== -1 && process.argv[argApp + 1]) ||
  process.env.BASE44_APP_ID ||
  '6a47712bfa122ada1db44167'

const API = `https://app.base44.com/api/apps/${APP_ID}/entities/Presentation`
const PAGE = 200

/**
 * Fields the app actually reads. Base44 also returns bookkeeping columns
 * (created_by_id, is_sample) that the local backend has no use for.
 */
const FIELDS = [
  'id',
  'title',
  'description',
  'ai_summary',
  'ai_confidence',
  'learning_objectives',
  'tags',
  'keywords',
  'primary_domain',
  'sub_domain',
  'category',
  'author',
  'file_type',
  'file_size',
  'file_url',
  'thumbnail_url',
  'slide_count',
  'view_count',
  'trend_score',
  'dropbox_id',
  'dropbox_path',
  'dropbox_rev',
  'modified_date',
  'last_synced',
  'sync_status',
  'status',
  'created_date',
  'updated_date',
]

async function fetchAll() {
  const all = []
  // Paging is `skip`, not `offset`: passing offset makes the endpoint return an
  // empty array rather than an error, which looks exactly like "no records".
  for (let skip = 0; ; skip += PAGE) {
    const res = await fetch(`${API}?limit=${PAGE}&skip=${skip}`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${API}`)

    const batch = await res.json()
    if (!Array.isArray(batch)) throw new Error('expected an array of records')

    all.push(...batch)
    process.stdout.write(`\r  fetched ${all.length}…`)
    if (batch.length < PAGE) break
  }
  process.stdout.write('\r')
  return all
}

/** Keeps the fields the app uses, in a stable key order, and drops the rest. */
function slim(record) {
  const out = {}
  for (const key of FIELDS) {
    if (record[key] !== undefined) out[key] = record[key]
  }
  return out
}

const records = await fetchAll()

// Dedupe by id — a paged read can repeat a row if the collection changes mid-run.
const byId = new Map()
for (const r of records) byId.set(r.id, slim(r))

// Sorted by id so re-running produces a diff of real changes, not row shuffling.
const catalog = [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))

fs.writeFileSync(OUT, `${JSON.stringify(catalog, null, 1)}\n`, 'utf8')

const active = catalog.filter((p) => p.status !== 'archived').length
const domains = new Set(catalog.map((p) => p.primary_domain).filter(Boolean))
const kb = (fs.statSync(OUT).size / 1024).toFixed(0)

console.log('')
console.log(`  app        ${APP_ID}`)
console.log(`  records    ${catalog.length}  (${active} active, ${catalog.length - active} archived)`)
console.log(`  domains    ${domains.size}`)
console.log(`  written    src/api/catalog.json  (${kb} KB)`)
console.log('')
