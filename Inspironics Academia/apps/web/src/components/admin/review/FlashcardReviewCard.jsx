import StatusBadge from '@/components/admin/StatusBadge';
import ReviewDecisionButtons from '@/components/admin/review/ReviewDecisionButtons';
import useEntityUpdate from '@/components/admin/review/useEntityUpdate';

export default function FlashcardReviewCard({ card }) {
  const update = useEntityUpdate('Flashcard');
  const setStatus = (status) => update.mutate({ id: card.id, data: { status } });

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg bg-primary/5 p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Front</div>
          <div className="text-sm font-medium">{card.front}</div>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Back</div>
          <div className="text-sm">{card.back}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={card.status} />
          {card.difficulty && <span className="text-xs text-muted-foreground capitalize">{card.difficulty}</span>}
        </div>
        <ReviewDecisionButtons
          status={card.status}
          disabled={update.isPending}
          onApprove={() => setStatus('approved')}
          onReject={() => setStatus('rejected')}
        />
      </div>
    </div>
  );
}
