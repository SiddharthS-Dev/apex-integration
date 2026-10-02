import { Layers } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import FlashcardReviewCard from '@/components/admin/review/FlashcardReviewCard';

export default function FlashcardsTab({ flashcards = [] }) {
  if (!flashcards.length) {
    return <EmptyState icon={Layers} title="No flashcards" description="Generate lesson content to create flashcards." />;
  }
  return (
    <div className="space-y-3">
      {flashcards.map((card) => (
        <FlashcardReviewCard key={card.id} card={card} />
      ))}
    </div>
  );
}
