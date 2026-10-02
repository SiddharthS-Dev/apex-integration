// Parses PlaybookVersion.chapters_snapshot safely → [{ number, title, summary }].
export function parseSnapshot(raw) {
  if (Array.isArray(raw)) return { chapters: raw, error: null };
  if (!raw) return { chapters: [], error: null };
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { chapters: parsed, error: null } : { chapters: [], error: 'Snapshot is not a list' };
  } catch {
    return { chapters: [], error: 'Snapshot could not be parsed' };
  }
}

const keyOf = (c, i) => {
  const num = c?.number != null && String(c.number).trim() ? String(c.number).trim().toLowerCase() : '';
  return num ? `n:${num}` : `t:${String(c?.title || i).trim().toLowerCase()}`;
};

// Pairs chapters from two snapshots → [{ key, status: added|removed|changed|unchanged, oldChapter, newChapter }].
export function compareChapters(oldList = [], newList = []) {
  const oldMap = new Map(oldList.map((c, i) => [keyOf(c, i), c]));
  const newMap = new Map(newList.map((c, i) => [keyOf(c, i), c]));
  const keys = [...new Set([...newMap.keys(), ...oldMap.keys()])];
  return keys.map((key) => {
    const oldChapter = oldMap.get(key);
    const newChapter = newMap.get(key);
    let status = 'unchanged';
    if (!oldChapter) status = 'added';
    else if (!newChapter) status = 'removed';
    else if ((oldChapter.title || '') !== (newChapter.title || '') || (oldChapter.summary || '') !== (newChapter.summary || '')) status = 'changed';
    return { key, status, oldChapter, newChapter };
  });
}
