import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/EmptyState';
import CourseMiniCard from '@/components/dashboard/CourseMiniCard';
import { usePublishedCourses } from '@/components/dashboard/useLearnerData';

export default function FeaturedCourses() {
  const { data: courses = [], isLoading } = usePublishedCourses();
  const featured = courses.slice(0, 3);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Featured courses</h2>
        <Button asChild variant="ghost" size="sm">
          <Link to="/courses">View all <ArrowRight /></Link>
        </Button>
      </div>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : featured.length === 0 ? (
        <EmptyState icon={BookOpen} title="No courses published yet" description="New courses appear here as soon as they are published." />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {featured.map((c) => <CourseMiniCard key={c.id} course={c} />)}
        </div>
      )}
    </section>
  );
}
