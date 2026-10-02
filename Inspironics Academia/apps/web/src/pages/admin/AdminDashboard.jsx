import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, BookOpen, Cloud, FileQuestion, FileText, LayoutDashboard, Loader2, Users } from 'lucide-react';
import { api } from '@/api/client';
import EmptyState from '@/components/EmptyState';
import PlaybookGenerationStatus from '@/components/admin/PlaybookGenerationStatus';
import LearnerProgressCard from '@/components/admin/dashboard/LearnerProgressCard';
import AdminAnalytics from '@/components/admin/AdminAnalytics';
import KpiDeck from '@/components/admin/control/KpiDeck';
import CoverageChart from '@/components/admin/control/CoverageChart';
import PendingSidebar from '@/components/admin/control/PendingSidebar';
import SystemActivity from '@/components/admin/control/SystemActivity';
import useReviewActions from '@/components/admin/control/useReviewActions';
import { activityFeed } from '@/components/admin/control/controlData';

async function loadDashboard() {
  const E = api.entities;
  const [playbooks, courses, lessons, users, assessments, certificates, progress, attempts, modules, questions, flashcards, syncLogs] =
    await Promise.all([
      E.Playbook.list('-created_date', 100),
      E.Course.list('-updated_date', 100),
      E.Lesson.list('-created_date', 500),
      E.User.list(),
      E.Assessment.list('-created_date', 100),
      E.Certificate.list('-created_date', 100),
      E.CourseProgress.list('-updated_date', 100),
      E.QuizAttempt.list('-created_date', 200),
      E.Module.list('-created_date', 200),
      E.Question.list('-created_date', 500),
      E.Flashcard.list('-created_date', 500),
      // Sync history only exists once Dropbox is connected; the dashboard works without it.
      api.sync.logs(20).catch(() => []),
    ]);
  return { playbooks, courses, lessons, users, assessments, certificates, progress, attempts, modules, questions, flashcards, syncLogs };
}

const LINKS = [
  { to: '/admin/playbooks', label: 'Playbooks', icon: FileText },
  { to: '/admin/courses', label: 'Courses', icon: BookOpen },
  { to: '/admin/questions', label: 'Questions', icon: FileQuestion },
  { to: '/admin/learners', label: 'Learners', icon: Users },
  { to: '/admin/integrations', label: 'Integrations', icon: Cloud },
];

// Real-time alerts: after the first load, every new activity event arrives as a stacked,
// dismissible toast (top right).
function useLiveAlerts(events) {
  const seen = useRef(null);
  useEffect(() => {
    if (!events) return;
    if (!seen.current) { seen.current = new Set(events.map((e) => e.id)); return; }
    const fresh = events.filter((e) => !seen.current.has(e.id));
    fresh.forEach((e) => seen.current.add(e.id));
    fresh.slice(0, 3).reverse().forEach((e) => {
      const show = e.kind === 'error' ? toast.error : e.kind === 'success' ? toast.success : toast.info;
      show(e.text, { description: 'Just now · live update' });
    });
  }, [events]);
}

export default function AdminDashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-dashboard'], queryFn: loadDashboard, refetchInterval: 30_000 });
  const [open, setOpen] = useState(null);
  const deckRef = useRef(null);
  const actions = useReviewActions(data || { questions: [], flashcards: [], lessons: [], assessments: [] });
  const events = data ? activityFeed(data, data.syncLogs) : null;
  useLiveAlerts(events);

  const close = useCallback(() => setOpen(null), []);
  const openQueue = (kind) => {
    deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setOpen({ kind, tab: 'Queue' });
  };

  return (
    <div className="hub relative min-h-[calc(100vh-4rem)] bg-[linear-gradient(180deg,hsl(var(--hub-bg-1)),hsl(var(--hub-bg-2)))]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/3 w-[40rem] h-[40rem] rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute top-96 -left-40 w-[30rem] h-[30rem] rounded-full bg-sky-500/10 blur-3xl" />
      </div>
      <div className="relative max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <header className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl glass tone-idle glass-glow flex items-center justify-center neon-text shrink-0"><LayoutDashboard className="w-6 h-6" /></div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Admin dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">Content pipeline, review queue and learner analytics · click a card to drill in</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Admin sections">
            {LINKS.map(({ to, label, icon: Icon }) => (
              <Link
                key={to} to={to}
                className="glass tone-idle inline-flex items-center gap-2 h-9 px-3 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:glass-glow active:scale-[0.98]"
              >
                <Icon className="w-4 h-4 neon-text" /> {label}
              </Link>
            ))}
          </nav>
        </header>

        {isLoading && <div className="h-64 flex items-center justify-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}
        {error && <EmptyState icon={AlertTriangle} title="Could not load dashboard" description={error.message} />}
        {data && (
          <>
            <div ref={deckRef} className="scroll-mt-20">
              <KpiDeck data={data} actions={actions} open={open} onOpen={setOpen} onClose={close} />
            </div>
            <div className="grid gap-5 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px] items-start">
              <div className="space-y-5 min-w-0">
                <CoverageChart lessons={data.lessons} />
                <SystemActivity events={events} />
              </div>
              <div className="space-y-5 min-w-0">
                <PendingSidebar data={data} actions={actions} onOpenQueue={openQueue} />
                <LearnerProgressCard progress={data.progress} users={data.users} courses={data.courses} certificates={data.certificates} />
              </div>
            </div>
            <PlaybookGenerationStatus playbooks={data.playbooks} courses={data.courses} modules={data.modules} lessons={data.lessons} />
            <AdminAnalytics progress={data.progress} courses={data.courses} attempts={data.attempts} />
          </>
        )}
      </div>
    </div>
  );
}
