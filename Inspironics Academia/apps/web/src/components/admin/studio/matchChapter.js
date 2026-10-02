const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// True when a lesson's source_chapter refers to the given chapter (title or number, contains either way).
export default function matchChapter(sourceChapter, chapter) {
  const src = norm(sourceChapter);
  if (!src) return false;
  const title = norm(chapter.title);
  if (title && (src.includes(title) || title.includes(src))) return true;
  const num = norm(chapter.number);
  if (!num) return false;
  if (src === num) return true;
  const escaped = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|chapter|part|module|unit|section|volume|book|ch\\.?)\\s*${escaped}(?![\\w.])`).test(src);
}
