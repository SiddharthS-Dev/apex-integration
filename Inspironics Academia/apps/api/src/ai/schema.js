// JSON-schema helpers shared by the AI providers.

// Gemini structured output treats fields that are not listed in `required` as optional and may leave
// them out (it returned quiz questions without options or answers). Every object asks for all of its
// fields unless the schema already says which are required.
export function requireAllFields(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(requireAllFields);
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = typeof v === 'object' ? requireAllFields(v) : v;
  if (out.type === 'object' && out.properties && !out.required) out.required = Object.keys(out.properties);
  return out;
}

/**
 * Lenient structural check of a model's JSON against the schema we asked for: types of the
 * properties that are present (missing optional fields are fine; the pipelines fill defaults).
 * Returns a list of problems (empty when it fits).
 */
export function checkShape(schema, value, path = '$', problems = []) {
  if (!schema || typeof schema !== 'object' || problems.length > 10) return problems;
  const t = schema.type;
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (value === undefined) return problems;
  if (t === 'object') {
    if (typeOf(value) !== 'object') { problems.push(`${path} should be an object`); return problems; }
    for (const k of schema.required || []) if (value[k] === undefined || value[k] === null) problems.push(`${path}.${k} is missing`);
    for (const [k, s] of Object.entries(schema.properties || {})) checkShape(s, value[k], `${path}.${k}`, problems);
  } else if (t === 'array') {
    if (!Array.isArray(value)) { problems.push(`${path} should be an array`); return problems; }
    value.slice(0, 200).forEach((v, i) => checkShape(schema.items, v, `${path}[${i}]`, problems));
  } else if (t === 'string') {
    if (value !== null && typeof value !== 'string') problems.push(`${path} should be a string`);
    // A runaway field (a model repeating itself inside a short field) is malformed output.
    else if (typeof value === 'string' && schema.maxLength && value.length > schema.maxLength) problems.push(`${path} is ${value.length} characters (at most ${schema.maxLength})`);
  } else if (t === 'integer' || t === 'number') {
    if (value !== null && typeof value !== 'number') problems.push(`${path} should be a number`);
  } else if (t === 'boolean') {
    if (value !== null && typeof value !== 'boolean') problems.push(`${path} should be a boolean`);
  }
  return problems;
}
