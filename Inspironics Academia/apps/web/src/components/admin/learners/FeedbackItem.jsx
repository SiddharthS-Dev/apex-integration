import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StatusBadge from '@/components/admin/StatusBadge';
import RatingStars from '@/components/admin/learners/RatingStars';
import { timeAgo } from '@/components/admin/adminFormat';

const STATUSES = ['open', 'reviewed', 'resolved'];

export default function FeedbackItem({ feedback, lesson, user, course, onStatus, busy }) {
  const status = feedback.status || 'open';
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <RatingStars rating={feedback.rating || 0} />
          <StatusBadge status={status} />
          <span className="text-xs text-muted-foreground">{timeAgo(feedback.created_date)}</span>
        </div>
        <div className="text-sm font-medium truncate">{lesson?.title || 'Unknown lesson'}</div>
        {course && <div className="text-xs text-muted-foreground truncate">{course.title}</div>}
        {feedback.comment ? (
          <p className="text-sm text-muted-foreground whitespace-pre-line">{feedback.comment}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No comment</p>
        )}
        <div className="text-xs text-muted-foreground">— {user?.full_name || user?.email || 'Learner'}</div>
      </div>
      <Select value={status} onValueChange={(value) => onStatus(feedback, value)} disabled={busy}>
        <SelectTrigger className="sm:w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
