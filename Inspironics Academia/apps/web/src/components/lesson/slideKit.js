// Shared by the slide layouts. Type is sized in container units (the player frame is the container),
// so a slide keeps its proportions at any player width — the way a rendered video would — with a
// floor for small screens.
export const size = (cqw, min) => ({ fontSize: `max(${min}px, ${cqw}cqw)` });

export const EASE = 'cubic-bezier(.22,1,.36,1)';
export const BOUNCE = 'cubic-bezier(.34,1.56,.64,1)';

/** A one-off entrance: runs once and holds its end state (pair it with className "sa-once"). */
export const once = (name, seconds, delay = 0, ease = EASE) => ({ animation: `${name} ${seconds}s ${ease} ${delay}s both` });

/** Style for an item that appears when the narration reaches it (laid out from the start, so nothing jumps). */
export const reveal = (visible, from = 'translateY(14px)') => ({
  opacity: visible ? 1 : 0,
  transform: visible ? 'none' : from,
  filter: visible ? 'none' : 'blur(6px)',
  transition: `opacity .6s ease, transform .8s ${BOUNCE}, filter .6s ease`,
});

/** The lit treatment for the item being spoken about. */
export const lit = ([a]) => ({ borderColor: `${a}80`, boxShadow: `0 0 3cqw -0.8cqw ${a}` });

// Right/wrong practice keeps one meaning across every slide, whatever the scene's accent.
export const TONES = {
  do: { color: '#34d399', soft: 'rgba(52,211,153,.12)' },
  dont: { color: '#fb7185', soft: 'rgba(251,113,133,.12)' },
};
