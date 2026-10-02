// Mongo-style filter queries shared by the API (JS fallback path) and the in-browser demo backend.
// Supported: equality, $in, $nin, $ne, $gt, $gte, $lt, $lte, $exists, $contains (array membership), $or, $and.

const OPERATORS = new Set(['$in', '$nin', '$ne', '$gt', '$gte', '$lt', '$lte', '$exists', '$contains']);

export function isOperatorObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.keys(value).every((k) => OPERATORS.has(k));
}

function equals(actual, expected) {
  if (Array.isArray(actual) && !Array.isArray(expected)) return actual.includes(expected);
  if (expected === null) return actual === null || actual === undefined;
  return actual === expected;
}

function matchOperators(actual, ops) {
  for (const [op, arg] of Object.entries(ops)) {
    switch (op) {
      case '$in': if (!Array.isArray(arg) || !arg.some((v) => equals(actual, v))) return false; break;
      case '$nin': if (Array.isArray(arg) && arg.some((v) => equals(actual, v))) return false; break;
      case '$ne': if (equals(actual, arg)) return false; break;
      case '$gt': if (!(actual > arg)) return false; break;
      case '$gte': if (!(actual >= arg)) return false; break;
      case '$lt': if (!(actual < arg)) return false; break;
      case '$lte': if (!(actual <= arg)) return false; break;
      case '$exists': if ((actual !== undefined && actual !== null) !== !!arg) return false; break;
      case '$contains': if (!Array.isArray(actual) || !actual.includes(arg)) return false; break;
      default: return false;
    }
  }
  return true;
}

export function matchesQuery(record, query = {}) {
  if (!query || typeof query !== 'object') return true;
  for (const [key, cond] of Object.entries(query)) {
    if (key === '$or') { if (!Array.isArray(cond) || !cond.some((q) => matchesQuery(record, q))) return false; continue; }
    if (key === '$and') { if (!Array.isArray(cond) || !cond.every((q) => matchesQuery(record, q))) return false; continue; }
    const actual = record?.[key];
    if (isOperatorObject(cond)) { if (!matchOperators(actual, cond)) return false; }
    else if (!equals(actual, cond)) return false;
  }
  return true;
}

// sort: '-created_date' | 'order' | undefined
export function sortRecords(records, sort) {
  if (!sort) return records;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...records].sort((a, b) => {
    const x = a[field];
    const y = b[field];
    if (x === y) return 0;
    if (x === undefined || x === null) return 1;
    if (y === undefined || y === null) return -1;
    const cmp = x < y ? -1 : 1;
    return desc ? -cmp : cmp;
  });
}
