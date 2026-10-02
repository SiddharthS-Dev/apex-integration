import { ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function QuizNav({ index, count, onPrev, onNext, onSubmit, canSubmit }) {
  const last = index === count - 1;
  return (
    <div className="flex items-center justify-between gap-3 mt-6">
      <Button variant="outline" onClick={onPrev} disabled={index === 0}>
        <ChevronLeft /> Previous
      </Button>
      {last ? (
        <Button onClick={onSubmit} disabled={!canSubmit}>
          <Send /> Submit
        </Button>
      ) : (
        <Button onClick={onNext}>
          Next <ChevronRight />
        </Button>
      )}
    </div>
  );
}
