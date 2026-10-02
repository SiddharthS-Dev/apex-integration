import { useAuth } from '@/lib/AuthContext';
import LoadingState from '@/components/LoadingState';
import WelcomeHero from '@/components/dashboard/WelcomeHero';
import DashboardStats from '@/components/dashboard/DashboardStats';
import ContinueLearning from '@/components/dashboard/ContinueLearning';
import LearningProgress from '@/components/dashboard/LearningProgress';
import RecommendedCourses, { pickRecommended } from '@/components/dashboard/RecommendedCourses';
import QuickActions from '@/components/dashboard/QuickActions';
import Achievements from '@/components/dashboard/Achievements';
import Upcoming from '@/components/dashboard/Upcoming';
import RecentActivity from '@/components/dashboard/RecentActivity';
import PlaybookLibrary from '@/components/dashboard/PlaybookLibrary';
import { Reveal } from '@/components/dashboard/DashParts';
import {
  activityDays, currentStreak, currentWeek, learnerStats, milestones, upcomingItems,
} from '@/components/dashboard/dashboardData';
import {
  continueHref, isCourseComplete, useCourseOutlines, useMyAttempts, useMyCertificates, useMyCourseRows,
  useMyReviewSchedules,
} from '@/components/dashboard/useLearnerData';

export default function LearnerDashboard() {
  const { user, isAdmin } = useAuth();
  const { rows, courses, isLoading } = useMyCourseRows();
  const { data: attempts = [] } = useMyAttempts();
  const { data: certificates = [] } = useMyCertificates();
  const { data: schedules = [] } = useMyReviewSchedules();

  const inProgress = rows.filter((r) => !isCourseComplete(r.progress));
  const recommended = pickRecommended(courses, rows);
  const { data: outlines = {} } = useCourseOutlines([...inProgress.map((r) => r.course.id), ...recommended.map((c) => c.id)]);

  const stats = learnerStats({ rows, attempts, certificates });
  const days = activityDays({ attempts, rows, schedules, certificates });
  const streak = currentStreak(days);

  if (isLoading) return <LoadingState label="Loading your dashboard…" />;

  const latest = inProgress[0];
  const resume = latest
    ? { to: continueHref(latest.course.id, outlines[latest.course.id], latest.progress), label: 'Continue Learning' }
    : { to: '/courses', label: 'Browse Courses' };

  return (
    <div className="dash relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] -z-0 opacity-70 dark:opacity-100"
        style={{ background: 'radial-gradient(50% 60% at 30% 0%, hsl(var(--dash-glow) / .10), transparent 70%)' }}
      />
      <div className="relative max-w-[1600px] mx-auto px-4 sm:px-6 py-5 sm:py-6 grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px] items-start">
        <div className="space-y-4 sm:space-y-5 min-w-0">
          <Reveal>
            <WelcomeHero
              name={user?.full_name?.split(' ')[0]}
              streak={streak}
              week={currentWeek(days)}
              resume={resume}
              hasProgress={rows.length > 0}
            />
          </Reveal>
          <Reveal delay={0.05}>
            <DashboardStats stats={stats} />
          </Reveal>
          <Reveal delay={0.1} className="grid gap-4 sm:gap-5 2xl:grid-cols-[minmax(0,1fr)_340px] items-stretch">
            <ContinueLearning rows={inProgress} outlines={outlines} />
            <LearningProgress attempts={attempts} completed={stats.completed} />
          </Reveal>
          <Reveal delay={0.12}>
            <PlaybookLibrary isAdmin={isAdmin} courses={courses} />
          </Reveal>
          <Reveal delay={0.15}>
            <RecommendedCourses courses={recommended} outlines={outlines} catalogSize={courses.length} />
          </Reveal>
        </div>
        <Reveal delay={0.1} className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-1 min-w-0">
          <QuickActions isAdmin={isAdmin} />
          <Achievements streak={streak} items={milestones(stats, streak)} />
          <Upcoming items={upcomingItems({ rows, schedules, courses })} />
          <RecentActivity attempts={attempts} courses={courses} />
        </Reveal>
      </div>
    </div>
  );
}
