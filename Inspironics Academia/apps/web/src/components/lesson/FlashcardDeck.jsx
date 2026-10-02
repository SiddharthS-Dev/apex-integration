import { useState } from 'react';
import { CalendarCheck, PartyPopper, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import FlashcardFlip from '@/components/lesson/FlashcardFlip';
import RatingButtons from '@/components/lesson/RatingButtons';

export default function FlashcardDeck({ deck, dueIds, onRate }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [saving, setSaving] = useState(false);

  if (index >= deck.length) {
    return (
      <div className="text-center py-10 space-y-3">
        <PartyPopper className="w-10 h-10 mx-auto text-primary" />
        <p className="font-semibold">Session complete</p>
        <p className="text-sm text-muted-foreground">Your review schedule has been updated.</p>
        <Button variant="outline" onClick={() => { setIndex(0); setFlipped(false); }}><RotateCcw />Review again</Button>
      </div>
    );
  }

  const card = deck[index];
  const rate = async (quality) => {
    setSaving(true);
    await onRate(card, quality);
    setSaving(false);
    setFlipped(false);
    setIndex((i) => i + 1);
  };

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Card {index + 1} of {deck.length}</span>
        {dueIds.has(card.id) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-2 py-0.5 font-medium">
            <CalendarCheck className="w-3 h-3" /> Due today
          </span>
        )}
      </div>
      <Progress value={(index / deck.length) * 100} />
      <FlashcardFlip card={card} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
      {flipped ? (
        <RatingButtons onRate={rate} disabled={saving} />
      ) : (
        <p className="text-center text-sm text-muted-foreground">Recall the answer, then flip the card to rate yourself.</p>
      )}
    </div>
  );
}
