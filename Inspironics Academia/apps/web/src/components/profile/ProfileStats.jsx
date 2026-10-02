import { Link } from 'react-router-dom';
import { ArrowRight, Award, BookOpen, CheckCircle2, Target } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  isCourseComplete, useMyAttempts, useMyCertificates, useMyProgress,
} from '@/components/dashboard/useLearnerData';

function StatTile({ icon: Icon, label, value, hint, tip }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="rounded-2xl border border-border bg-card p-5 outline-none transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 hover:border-blue-500/40 hover:shadow-[0_8px_24px_rgba(59,130,246,0.2)] focus-visible:-translate-y-1 focus-visible:shadow-[0_8px_24px_rgba(59,130,246,0.2)] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{label}</span>
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-bold mt-2 tabular-nums">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className="max-w-[16rem] rounded-xl bg-slate-900 text-slate-100 border border-slate-700 px-3 py-2 text-xs leading-relaxed shadow-xl">
        {tip.text}{' '}
        <Link to={tip.to} className="inline-flex items-center gap-0.5 font-semibold text-violet-300 hover:text-violet-200 hover:underline">
          {tip.link} <ArrowRight className="w-3 h-3" />
        </Link>
      </TooltipContent>
    </Tooltip>
  );
}

export default function ProfileStats() {
  const { data: progress = [] } = useMyProgress();
  const { data: attempts = [] } = useMyAttempts();
  const { data: certificates = [] } = useMyCertificates();
  const lessons = progress.reduce((s, p) => s + (p.completed_lessons?.length || 0), 0);
  const completed = progress.filter(isCourseComplete).length;
  const inProgress = progress.length - completed;
  const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + (a.percentage || 0), 0) / attempts.length) : null;

  const browse = { text: "You haven't started any courses yet.", link: 'Browse the catalog', to: '/courses' };
  const tips = {
    lessons: progress.length ? { text: `${lessons} lesson${lessons === 1 ? '' : 's'} done across ${progress.length} course${progress.length === 1 ? '' : 's'}.`, link: 'Continue learning', to: '/my-learning' } : browse,
    courses: !progress.length ? browse
      : inProgress ? { text: `${inProgress} course${inProgress === 1 ? '' : 's'} still in progress.`, link: 'Pick up where you left off', to: '/my-learning' }
        : { text: 'Every course you started is complete.', link: 'Find your next course', to: '/courses' },
    quiz: attempts.length ? { text: `Based on ${attempts.length} quiz and test attempt${attempts.length === 1 ? '' : 's'}.`, link: 'See your results', to: '/tests' } : { text: 'Take a lesson quiz or test to see your average.', link: 'Go to tests', to: '/tests' },
    certs: certificates.length ? { text: `${certificates.length} verifiable certificate${certificates.length === 1 ? '' : 's'} earned.`, link: 'View certificates', to: '/certificates' } : { text: 'Pass a course’s final test to earn one.', link: 'Go to tests', to: '/tests' },
  };

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Learning stats</h2>
      <TooltipProvider delayDuration={150}>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatTile icon={BookOpen} label="Lessons completed" value={lessons} hint={`${progress.length} courses started`} tip={tips.lessons} />
          <StatTile icon={CheckCircle2} label="Courses completed" value={completed} tip={tips.courses} />
          <StatTile icon={Target} label="Avg quiz score" value={avg === null ? '—' : `${avg}%`} hint={`${attempts.length} attempts`} tip={tips.quiz} />
          <StatTile icon={Award} label="Certificates" value={certificates.length} tip={tips.certs} />
        </div>
      </TooltipProvider>
    </section>
  );
}
