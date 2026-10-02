// Subtitles: the cue being spoken, centred above the player controls. Sized in container units like
// the slide, so they stay in proportion with the frame.
export default function Captions({ cue }) {
  if (!cue) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[17%] flex justify-center px-[6cqw]" aria-live="off">
      <p
        key={cue.start}
        className="max-w-[86%] rounded-[0.8cqw] bg-black/75 px-[1.6cqw] py-[0.7cqw] text-center font-medium leading-snug text-white shadow-lg animate-in fade-in duration-200"
        style={{ fontSize: 'max(11px, 2.05cqw)' }}
      >
        {cue.text}
      </p>
    </div>
  );
}
