import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SourceRef from '@/components/admin/SourceRef';
import QuestionMeta from '@/components/admin/questions/QuestionMeta';
import QuestionOptions from '@/components/admin/questions/QuestionOptions';

export default function QuestionCard({ question, context, onStatus, onEdit, busy }) {
  const status = question.status || 'pending_review';
  return (
    <article className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <QuestionMeta question={question} context={context} />
      <p className="font-medium leading-relaxed">{question.question_text}</p>
      <QuestionOptions question={question} />
      {question.explanation && (
        <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <span className="font-medium">Explanation: </span>
          <span className="text-muted-foreground">{question.explanation}</span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <SourceRef playbook={question.source_playbook} chapter={question.source_chapter} section={question.source_section} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onEdit(question)} disabled={busy}>
            <Pencil /> Edit
          </Button>
          {status !== 'rejected' && (
            <Button size="sm" variant="outline" onClick={() => onStatus(question, 'rejected')} disabled={busy} className="text-rose-600 hover:text-rose-700 dark:text-rose-400">
              <X /> Reject
            </Button>
          )}
          {status !== 'approved' && (
            <Button size="sm" onClick={() => onStatus(question, 'approved')} disabled={busy}>
              <Check /> Approve
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
