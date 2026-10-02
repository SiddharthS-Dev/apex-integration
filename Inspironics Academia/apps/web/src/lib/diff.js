// Word-level LCS diff used by PlaybookVersionHistory.
// Returns [{ type: 'equal' | 'added' | 'removed', value: string }].

function tokenize(text = '') {
  return String(text).split(/(\s+)/).filter((t) => t.length > 0);
}

export function diffWords(oldText = '', newText = '') {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  // Guard against quadratic blow-up on huge inputs.
  if (a.length * b.length > 4_000_000) {
    return [
      { type: 'removed', value: oldText },
      { type: 'added', value: newText },
    ];
  }
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  const push = (type, value) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.value += value;
    else out.push({ type, value });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { push('equal', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('removed', a[i]); i++; }
    else { push('added', b[j]); j++; }
  }
  while (i < m) push('removed', a[i++]);
  while (j < n) push('added', b[j++]);
  return out;
}

export function diffStats(parts = []) {
  const count = (type) => parts.filter((p) => p.type === type).reduce((s, p) => s + tokenize(p.value).filter((t) => t.trim()).length, 0);
  return { added: count('added'), removed: count('removed') };
}
