import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Clock, Compass, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CourseBadges from '@/components/catalog/CourseBadges';
import CourseArt from '@/components/dashboard/CourseArt';
import { DashEmpty, HeaderLink, Panel, SectionHeader } from '@/components/dashboard/DashParts';
import { estimateMinutes, formatMinutes } from '@/components/dashboard/dashboardData';

// Published courses the learner hasn't started yet.
export function pickRecommended(courses, rows) {
  const started = new Set(rows.map((r) => r.course.id));
  return courses.filter((c) => !started.has(c.id)).slice(0, 3);
}

function RecommendedCard({ course, outline }) {
  const duration = formatMinutes(estimateMinutes(outline?.lessons));
  const lessons = course.lesson_count || outline?.lessons?.length || 0;
  return (
    <Link to={`/courses/${course.id}`} className="group dash-panel dash-hover p-3 flex items-center gap-3.5 min-w-0">
      <CourseArt course={course} compact className="w-24 h-20 sm:w-28 rounded-xl shrink-0" />
      <div className="min-w-0 flex-1">
        <CourseBadges course={course} className="gap-1.5 mb-1.5" />
        <h3 className="text-sm font-semibold leading-snug line-clamp-1 group-hover:text-primary transition-colors">{course.title}</h3>
        {course.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{course.description}</p>}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1.5">
          <span className="inline-flex items-center gap-1"><BookOpen className="w-3 h-3" />{lessons} lessons</span>
          {duration && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{duration}</span>}
        </div>
      </div>
      <span className="w-7 h-7 rounded-full border border-[hsl(var(--dash-line))] flex items-center justify-center shrink-0 transition-colors group-hover:bg-primary group-hover:border-primary group-hover:text-primary-foreground">
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </Link>
  );
}

export default function RecommendedCourses({ courses, outlines, catalogSize }) {
  return (
    <Panel>
      <SectionHeader
        icon={Sparkles}
        title="Recommended for You"
        subtitle="Courses you haven't started yet"
        action={courses.length > 0 && <HeaderLink to="/courses">View all</HeaderLink>}
      />
      {courses.length === 0 ? (
        <DashEmpty
          icon={Compass}
          title="No new recommendations"
          description={catalogSize
            ? "You've started every published course. New courses will appear here as they're added."
            : 'No courses have been published yet. Check back soon.'}
          action={<Button asChild size="sm" variant="outline"><Link to="/courses">Browse catalog</Link></Button>}
          className="py-6"
        />
      ) : (
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {courses.map((c) => <RecommendedCard key={c.id} course={c} outline={outlines[c.id]} />)}
        </div>
      )}
    </Panel>
  );
}
