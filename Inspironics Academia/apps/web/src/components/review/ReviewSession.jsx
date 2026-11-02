import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, BookOpen, PartyPopper, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import FlashcardFlip from '@/components/lesson/FlashcardFlip';
import RatingButtons from '@/components/lesson/RatingButtons';
import { Panel } from '@/components/dashboard/DashParts';
import { submitReview } from '@/lib/retention';

// One sitting through a snapshot of the queue (due cards, then new ones). A card rated "Again" comes
// back once at the end of the sitting, so the learner leaves having recalled it at least once.
export default function ReviewSession({ cards, onRated, onExit }) {
  const [deck, setDeck] = useState(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tally, setTally] = useState({ total: 0, recalled: 0, again: 0 });
  const [requeued, setRequeued] = useState(() => new Set());

  if (index >= deck.length) {
    const pct = tally.total ? Math.round((tally.recalled / tally.total) * 100) : 0;
    return (
      <Panel className="text-center py-10 space-y-4">
        <PartyPopper className="w-10 h-10 mx-auto text-primary" />
        <div>
          <p className="text-lg font-semibold">Session complete</p>
          <p className="text-sm text-muted-foreground">
            {tally.total} review{tally.total === 1 ? '' : 's'} · {pct}% recalled{tally.again ? ` · ${tally.again} to relearn` : ''}
          </p>
        </div>
        <Button onClick={onExit}><ArrowLeft /> Back to overview</Button>
      </Panel>
    );
  }

  const card = deck[index];
  const rate = async (quality) => {
    setSaving(true);
    try {
      await submitReview(card.id, quality);
      onRated?.();
      const forgot = quality < 3;
      setTally((t) => ({ total: t.total + 1, recalled: t.recalled + (forgot ? 0 : 1), again: t.again + (forgot ? 1 : 0) }));
      if (forgot && !requeued.has(card.id)) {
        // Back once at the end; its intervals now preview from a fresh start.
        setDeck((d) => [...d, { ...card, schedule: null, intervals: { again: 1, hard: 1, good: 1, easy: 1 }, retry: true }]);
        setRequeued((s) => new Set(s).add(card.id));
      }
      setFlipped(false);
      setIndex((i) => i + 1);
    } catch (e) {
      toast.error(e?.message || 'Could not save review');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">Card {index + 1} of {deck.length}</span>
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {!card.schedule && !card.retry && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300 px-2 py-0.5 font-medium shrink-0">
              <Sparkles className="w-3 h-3" /> New
            </span>
          )}
          {card.retry && <span className="rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 px-2 py-0.5 font-medium shrink-0">Relearn</span>}
          <span className="truncate" title={card.course_title}>{card.course_title}</span>
        </span>
      </div>
      <Progress value={(index / deck.length) * 100} />
      <FlashcardFlip card={card} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
      {flipped ? (
        <RatingButtons onRate={rate} disabled={saving} intervals={card.intervals} />
      ) : (
        <p className="text-center text-sm text-muted-foreground">Recall the answer, then flip the card to rate yourself.</p>
      )}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        {card.lesson_title && card.course_id ? (
          <Link to={`/learn/${card.course_id}/${card.lesson_id}`} className="inline-flex items-center gap-1 hover:text-foreground min-w-0">
            <BookOpen className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{card.lesson_title}</span>
          </Link>
        ) : <span />}
        <button type="button" onClick={onExit} className="hover:text-foreground shrink-0">End session</button>
      </div>
    </div>
  );
}
