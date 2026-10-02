import { ENTITIES } from '@academy/shared';

// Maps entity schemas (packages/shared) to SQL tables: one table per entity, one column per property.
// Arrays/objects are stored as JSON text; dates as ISO strings (sortable).

export const BUILTIN_COLUMNS = ['id', 'created_date', 'updated_date', 'created_by_id'];

export function tableName(entity) {
  return 'e_' + entity.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function columnKind(prop) {
  switch (prop?.type) {
    case 'number': case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'array': case 'object': return 'json';
    default: return 'text';
  }
}

export function sqlType(kind, dialect) {
  if (kind === 'number') return dialect === 'postgres' ? 'DOUBLE PRECISION' : 'REAL';
  if (kind === 'boolean') return dialect === 'postgres' ? 'BOOLEAN' : 'INTEGER';
  return 'TEXT';
}

export function entitySchema(entity) {
  return ENTITIES[entity];
}

// Column metadata for an entity: [{ name, kind }] including built-ins.
export function columnsFor(entity) {
  const schema = ENTITIES[entity];
  const cols = BUILTIN_COLUMNS.map((name) => ({ name, kind: 'text' }));
  for (const [name, prop] of Object.entries(schema.properties)) cols.push({ name, kind: columnKind(prop) });
  return cols;
}

export const quote = (name) => `"${name.replace(/"/g, '')}"`;
