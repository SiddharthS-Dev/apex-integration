// Evaluates the declarative RLS rules in ENTITIES[name].rls for a given user.
//
// Rule grammar (same as the original Base44 schemas):
//   {}                                  → everyone signed in (the API requires a session for all entity routes)
//   { "user_condition": { "role": "admin" } }
//   { "data.user_id": "{{user.id}}" }   → condition on the record
//   { "$or": [ rule, rule ] }
//
// ruleToQuery turns a rule into a record filter query:
//   true  → no restriction, false → deny all, object → filter query (see query.js).

function userMatches(user, condition) {
  if (!user) return false;
  return Object.entries(condition).every(([k, v]) => user[k] === v);
}

function resolveValue(value, user) {
  if (typeof value !== 'string') return value;
  const m = value.match(/^\{\{user\.(\w+)\}\}$/);
  if (!m) return value;
  return user ? user[m[1]] : undefined;
}

export function ruleToQuery(rule, user) {
  if (!rule || Object.keys(rule).length === 0) return true;
  if (rule.$or) {
    const parts = rule.$or.map((r) => ruleToQuery(r, user));
    if (parts.some((p) => p === true)) return true;
    const queries = parts.filter((p) => p !== false);
    if (queries.length === 0) return false;
    return queries.length === 1 ? queries[0] : { $or: queries };
  }
  const query = {};
  for (const [key, value] of Object.entries(rule)) {
    if (key === 'user_condition') {
      if (!userMatches(user, value)) return false;
      continue;
    }
    if (key.startsWith('data.')) {
      const resolved = resolveValue(value, user);
      if (resolved === undefined) return false;
      query[key.slice(5)] = resolved;
    }
  }
  return Object.keys(query).length ? query : true;
}

export function ruleFor(entitySchema, action) {
  return entitySchema?.rls?.[action];
}
