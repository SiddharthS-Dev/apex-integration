// Applies pending migrations to DATABASE_URL (Postgres) or SQLITE_PATH (SQLite).
// Prints the resolved target first, and refuses the default data directory (apps/api/data) unless
// --allow-default-db or APEX_ALLOW_DEFAULT_DB=1 is given (see db/safety.js).
import { config } from '../config.js';
import { guardCliTarget } from './safety.js';

guardCliTarget('migrate', config);
const { closeDb, getDb } = await import('./index.js');
const { migrate } = await import('./migrations.js');
const db = await getDb();
await migrate(db);
await closeDb();
console.log('Migrations complete');
