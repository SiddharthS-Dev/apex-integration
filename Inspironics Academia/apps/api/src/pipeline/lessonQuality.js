// Automatic quality check of generated lesson content against its source chapter. Free and
// deterministic (no AI call): it measures what a reviewer would otherwise check by hand.
//
//   errors   — the answer is not usable (runaway repetition, not grounded in the playbook, no usable
//              quiz): the generator retries once and saves nothing if the problem persists;
//   warnings — saved, shown to the reviewer as the things to look at.
//
// A lesson whose report has no warnings "passed automatic checks"; a reviewer can approve those in one
// step and spend their time on the flagged ones. Approval itself always stays a human decision.

export const QUALITY_VERSION = 1;

const words = (s) => String(s || '').toLowerCase().match(/[a-z][a-z0-9-]*/g) || [];
const sentences = (s) => String(s || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['because', 'between', 'through', 'without', 'another', 'something', 'everything', 'example', 'remember', 'together', 'important', 'understand', 'different', 'lesson', 'learning', 'today', 'welcome', 'engineering', 'academy']);

/** Share of the script's distinctive vocabulary (words of 7+ letters) that also appears in the source. */
export function groundingScore(text, source) {
  const src = new Set(words(source));
  const terms = [...new Set(words(text).filter((w) => w.length >= 7 && !STOP.has(w)))];
  if (!terms.length || !src.size) return { score: null, terms: terms.length, found: 0 };
  const found = terms.filter((t) => src.has(t) || src.has(t.replace(/s$/, '')) || src.has(`${t}s`)).length;
  return { score: +(found / terms.length).toFixed(2), terms: terms.length, found };
}

/** Longest run of a repeated 6-word sequence, and sentences repeated three times or more. */
export function repetition(text) {
  const w = words(text);
  const counts = new Map();
  for (let i = 0; i + 6 <= w.length; i++) {
    const k = w.slice(i, i + 6).join(' ');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const maxNgram = Math.max(0, ...counts.values());
  const sc = new Map();
  for (const s of sentences(text)) { const k = norm(s); if (k.split(' ').length >= 4) sc.set(k, (sc.get(k) || 0) + 1); }
  const repeatedSentences = [...sc.values()].filter((n) => n >= 3).length;
  return { maxNgram, repeatedSentences };
}

/** Numbers (2+ digits, percentages, versions) in the text that never appear in the source. */
export function unsupportedNumbers(text, source) {
  const src = String(source || '');
  const nums = [...new Set(String(text || '').match(/\b\d{2,}(?:[.,]\d+)?%?|\b\d+(?:\.\d+)+\b/g) || [])];
  return nums.filter((n) => !src.includes(n.replace(/%$/, '')));
}

/**
 * Spreads correct answers over the option positions (question i → position i mod n), keeping the
 * other options in their order. Models tend to put the answer in the same slot every time, which
 * makes a quiz guessable; this fixes that without another AI call.
 */
export function balanceAnswerPositions(questions) {
  return questions.map((q, i) => {
    const opts = [...(q.options || [])];
    const at = opts.indexOf(q.correct_answer);
    if (at < 0 || opts.length < 2) return q;
    const others = opts.filter((_, k) => k !== at);
    const target = i % opts.length;
    others.splice(target, 0, q.correct_answer);
    return { ...q, options: others };
  });
}

const list = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x || '').replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);

/**
 * Quality report for one lesson's content. `content` = { video_title, teaching_script, summary,
 * key_points, examples, questions: [{ question_text, options, correct_answer, explanation }],
 * flashcards: [{ front, back }] }; `source` = the chapter text the lesson is generated from.
 */
export function assessLessonQuality(content, source = '') {
  const issues = [];
  const err = (code, message) => issues.push({ severity: 'error', code, message });
  const warn = (code, message) => issues.push({ severity: 'warning', code, message });
  const script = String(content.teaching_script || '').trim();
  const nWords = words(script).length;

  // Script
  if (nWords < 300) err('script_short', `Script has only ${nWords} words`);
  else if (nWords < 700) warn('script_short', `Script is short (${nWords} words; 1,200–1,700 requested)`);
  else if (nWords > 2600) warn('script_long', `Script is long (${nWords} words; 1,200–1,700 requested)`);
  if (/^\s*#|\*\*|^\s*[-*•]\s|\[(pause|music|slide)[^\]]*\]/im.test(script)) warn('script_format', 'Script contains markdown, bullets or stage directions (it is read aloud)');
  const rep = repetition(script);
  if (rep.maxNgram >= 6 || rep.repeatedSentences >= 2) err('repetition', `Script repeats itself (a 6-word phrase ${rep.maxNgram}×, ${rep.repeatedSentences} sentence(s) repeated 3+ times)`);
  else if (rep.maxNgram >= 4) warn('repetition', `A 6-word phrase appears ${rep.maxNgram} times`);

  // Grounding in the playbook
  const g = groundingScore(`${script} ${list(content.key_points).join(' ')}`, source);
  if (g.score != null) {
    if (g.score < 0.35) err('grounding', `Only ${Math.round(g.score * 100)}% of the script's technical vocabulary appears in the source chapter`);
    else if (g.score < 0.55) warn('grounding', `${Math.round(g.score * 100)}% of the script's technical vocabulary appears in the source chapter — check for content not in the playbook`);
  }
  const nums = unsupportedNumbers(`${script} ${list(content.key_points).join(' ')} ${content.summary || ''}`, source);
  if (nums.length) warn('numbers', `Figures not found in the source chapter: ${nums.slice(0, 6).join(', ')}${nums.length > 6 ? '…' : ''}`);

  // Title, summary, key points, examples
  const title = String(content.video_title || '').trim();
  if (!title) err('title', 'No video title');
  else if (title.length > 110 || title.split(/\s+/).length > 16) warn('title', `Video title is long (${title.length} characters)`);
  const nSum = sentences(content.summary).length;
  // Every field the lesson page shows must be filled: an empty one blocks saving (and is asked for again).
  if (!nSum) err('summary', 'No summary');
  else if (nSum > 7) warn('summary', `Summary has ${nSum} sentences (3–5 requested)`);
  const kp = list(content.key_points);
  if (kp.length < 3) err('key_points', `Only ${kp.length} key points (5–8 requested)`);
  else if (kp.length < 4 || kp.length > 10) warn('key_points', `${kp.length} key points (5–8 requested)`);
  if (!list(content.examples).length) err('examples', 'No worked examples');

  // Quiz
  const qs = content.questions || [];
  if (qs.length < 4) err('quiz_count', `Only ${qs.length} usable quiz questions`);
  else if (qs.length < 6) warn('quiz_count', `${qs.length} quiz questions (6 requested)`);
  const qTexts = new Set();
  let longestIsCorrect = 0;
  const positions = new Map();
  qs.forEach((q, i) => {
    const opts = (q.options || []).map((o) => String(o).trim());
    const label = `Question ${i + 1}`;
    if (new Set(opts.map(norm)).size !== opts.length) warn('quiz_options', `${label} has duplicate options`);
    if (opts.length !== 4) warn('quiz_options', `${label} has ${opts.length} options (4 requested)`);
    if (!opts.includes(String(q.correct_answer).trim())) err('quiz_answer', `${label}: the correct answer is not one of its options`);
    if (opts.some((o) => /\b(all|none) of the above\b/i.test(o))) warn('quiz_options', `${label} uses "all/none of the above"`);
    if (String(q.explanation || '').trim().length < 20) warn('quiz_explanation', `${label} has no real explanation`);
    const key = norm(q.question_text);
    if (qTexts.has(key)) warn('quiz_duplicate', `${label} duplicates another question`);
    qTexts.add(key);
    const idx = opts.indexOf(String(q.correct_answer).trim());
    positions.set(idx, (positions.get(idx) || 0) + 1);
    const lengths = opts.map((o) => o.length);
    if (idx >= 0 && lengths[idx] === Math.max(...lengths) && lengths[idx] > 1.3 * [...lengths].sort((a, b) => b - a)[1]) longestIsCorrect++;
  });
  if (qs.length >= 4 && Math.max(0, ...positions.values()) === qs.length) warn('quiz_pattern', 'Every correct answer is in the same position');
  if (qs.length >= 4 && longestIsCorrect >= Math.ceil(qs.length * 0.75)) warn('quiz_pattern', `The correct answer is clearly the longest option in ${longestIsCorrect} of ${qs.length} questions (guessable)`);

  // Flashcards
  const fcs = content.flashcards || [];
  if (fcs.length < 3) err('flashcards', `Only ${fcs.length} usable flashcards`);
  else if (fcs.length < 5) warn('flashcards', `${fcs.length} flashcards (5 requested)`);
  if (new Set(fcs.map((f) => norm(f.front))).size !== fcs.length) warn('flashcards', 'Duplicate flashcards');
  if (fcs.some((f) => String(f.back || '').trim().length < 10)) warn('flashcards', 'A flashcard has an empty or one-word back');

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const score = Math.max(0, 100 - errors * 40 - warnings * 8);
  return {
    version: QUALITY_VERSION,
    checked_at: new Date().toISOString(),
    score,
    passed: errors === 0 && warnings === 0,
    usable: errors === 0,
    issues,
    metrics: { words: nWords, grounding: g.score, questions: qs.length, flashcards: fcs.length, key_points: kp.length },
  };
}
