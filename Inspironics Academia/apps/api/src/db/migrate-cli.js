import { closeDb, getDb } from './index.js';
import { migrate } from './migrations.js';

const db = await getDb();
await migrate(db);
await closeDb();
console.log('Migrations complete');
