import { DEFAULT_CATEGORIES, SYNC_DEFAULT_CATEGORY } from '@academy/shared';
import { log } from '../lib/logger.js';
import { create, list } from '../repo/entities.js';
import { quote, tableName } from './schema.js';
import { coreIdentityBackfill } from '../core/index.js';

// Data migrations: one-off changes to existing records, run after the entity tables are reconciled
// and recorded in schema_migrations like the core ones. They only ever fill in what is missing —
// nothing is deleted, renamed or moved, and Dropbox is never touched.

const DATA_MIGRATIONS = [
  {
    // Role-based categories: every playbook that existed before categories did goes to the Corporate
    // Knowledge Base (Employees & Teams), as do its courses. Chapters, versions, Dropbox paths and
    // source references are untouched. Nothing is redistributed by filename or content.
    id: 'data_001_playbook_categories',
    run: async (db) => {
      const pb = quote(tableName('Playbook'));
      const course = quote(tableName('Course'));
      const playbooks = await db.run(
        `UPDATE ${pb} SET ${quote('category')} = ?, ${quote('category_source')} = ? WHERE ${quote('category')} IS NULL OR ${quote('category')} = ''`,
        [SYNC_DEFAULT_CATEGORY, 'migration'],
      );
      const courses = await db.run(
        `UPDATE ${course} SET ${quote('category')} = (SELECT p.${quote('category')} FROM ${pb} p WHERE p.${quote('id')} = ${course}.${quote('playbook_id')})
         WHERE (${quote('category')} IS NULL OR ${quote('category')} = '') AND ${quote('playbook_id')} IS NOT NULL`,
      );
      return { playbooks: playbooks.changes, courses: courses.changes };
    },
  },
  {
    // R1 (ADR 0004): the Inspironics organisation, and for every existing user an Inspironics membership
    // with a staff (employee/leadership) or intern role, plus platform_admin (role admin) or learner
    // (role user). Inserts only into the 008_core_identity tables; users is read, never written. One
    // transaction; one audit event per user. Idempotent: nothing is inserted that already exists.
    id: 'core_identity_backfill',
    run: (db) => coreIdentityBackfill(db),
  },
];

/** Creates the standard categories that are missing (an admin may have edited the others). */
async function seedCategories() {
  const existing = new Set((await list('PlaybookCategory', { limit: 1000 })).map((c) => c.key));
  for (const c of DEFAULT_CATEGORIES) {
    if (existing.has(c.key)) continue;
    await create('PlaybookCategory', c);
    log.info('db.category_created', { key: c.key });
  }
}

export async function runDataMigrations(db, { exclude = new Set() } = {}) {
  await seedCategories();
  const applied = new Set((await db.query('SELECT id FROM schema_migrations')).map((r) => r.id));
  for (const m of DATA_MIGRATIONS) {
    if (applied.has(m.id) || exclude.has(m.id)) continue;
    const result = await m.run(db);
    await db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, new Date().toISOString()]);
    log.info('db.data_migration_applied', { id: m.id, ...result });
  }
}
