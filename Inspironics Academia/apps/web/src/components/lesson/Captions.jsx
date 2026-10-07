// Subtitles: the cue being spoken, centred above the player controls. Sized in container units like
// the slide, so they stay in proportion with the frame.
export default function Captions({ cue }) {
  if (!cue) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[17%] flex justify-center px-[6cqw]" aria-live="off">
      <p
        key={cue.start}
        className="max-w-[86%] rounded-[1cqw] border border-white/10 bg-black/60 px-[1.8cqw] py-[0.8cqw] text-center font-medium leading-snug text-white shadow-[0_1cqw_3cqw_-1cqw_rgba(0,0,0,.8)] backdrop-blur-md animate-in fade-in slide-in-from-bottom-1 duration-300"
        style={{ fontSize: 'max(11px, 2.05cqw)' }}
      >
        {cue.text}
      </p>
    </div>
  );
}
