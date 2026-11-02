import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BrainCircuit, CalendarCheck, Library, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import { Panel } from '@/components/dashboard/DashParts';
import ReviewStats from '@/components/review/ReviewStats';
import ReviewForecast from '@/components/review/ReviewForecast';
import ReviewSession from '@/components/review/ReviewSession';
import { relativeDay, useInvalidateReviews, useReviewQueue } from '@/lib/retention';

export default function DailyReview() {
  const queue = useReviewQueue();
  const invalidate = useInvalidateReviews();
  const [session, setSession] = useState(null);

  if (queue.isLoading) return <LoadingState label="Building today's review…" />;
  if (queue.error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState icon={AlertTriangle} title="Could not load your review" description={queue.error.message} />
      </div>
    );
  }

  const { due = [], new: fresh = [], stats } = queue.data;
  const cards = [...due, ...fresh];
  const nextDue = stats.forecast.find((f, i) => i > 0 && f.count > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <PageHeader
        icon={BrainCircuit}
        title="Daily Review"
        description="Spaced repetition across every lesson you've completed. Cards you know come back less often."
        actions={!session && cards.length > 0 && (
          <Button onClick={() => setSession(cards)}><Play /> Start review ({cards.length})</Button>
        )}
      />

      {session ? (
        <ReviewSession cards={session} onRated={invalidate} onExit={() => { setSession(null); invalidate(); }} />
      ) : (
        <>
          <ReviewStats stats={stats} newToday={fresh.length} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start">
            <Panel className="space-y-3">
              {cards.length ? (
                <>
                  <h2 className="text-base font-semibold">Today's session</h2>
                  <ul className="text-sm space-y-1.5 text-muted-foreground">
                    <li><span className="font-medium text-foreground tabular-nums">{due.length}</span> due for review{stats.overdue ? ` (${stats.overdue} overdue)` : ''}</li>
                    <li><span className="font-medium text-foreground tabular-nums">{fresh.length}</span> new card{fresh.length === 1 ? '' : 's'} from completed lessons</li>
                  </ul>
                  <Button className="w-full" onClick={() => setSession(cards)}><Play /> Start review</Button>
                </>
              ) : stats.learned || stats.new_available ? (
                <div className="text-center py-6 space-y-2">
                  <CalendarCheck className="w-9 h-9 mx-auto text-emerald-500" />
                  <p className="font-semibold">All caught up</p>
                  <p className="text-sm text-muted-foreground">
                    {nextDue ? `Next cards are due ${relativeDay(nextDue.date, queue.data.today)}.` : 'Nothing else is due this week.'}
                    {stats.new_available > 0 && ' You have used today\'s new-card allowance.'}
                  </p>
                </div>
              ) : (
                <EmptyState
                  icon={Library}
                  title="No cards yet"
                  description="Complete a lesson and its flashcards join your daily review."
                  action={<Button asChild size="sm"><Link to="/my-learning">Go to My Learning</Link></Button>}
                />
              )}
            </Panel>
            <ReviewForecast forecast={stats.forecast} />
          </div>
        </>
      )}
    </div>
  );
}
