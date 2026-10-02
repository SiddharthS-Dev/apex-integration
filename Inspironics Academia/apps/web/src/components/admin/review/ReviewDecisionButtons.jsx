import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ReviewDecisionButtons({ status, disabled, onApprove, onReject }) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || status === 'approved'}
        onClick={onApprove}
        className="text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
      >
        <Check />Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || status === 'rejected'}
        onClick={onReject}
        className="text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
      >
        <X />Reject
      </Button>
    </div>
  );
}
