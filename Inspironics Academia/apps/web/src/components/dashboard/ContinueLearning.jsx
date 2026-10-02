import { Link } from 'react-router-dom';
import { BookOpen, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ContinueCard from '@/components/dashboard/ContinueCard';
import { DashEmpty, HeaderLink, Panel, SectionHeader } from '@/components/dashboard/DashParts';

export default function ContinueLearning({ rows, outlines }) {
  return (
    <Panel className="min-w-0">
      <SectionHeader
        icon={PlayCircle}
        title="Continue Learning"
        subtitle="Pick up where you left off and keep your streak going."
        action={rows.length > 0 && <HeaderLink to="/my-learning">View all courses</HeaderLink>}
      />
      {rows.length === 0 ? (
        <DashEmpty
          icon={BookOpen}
          title="Nothing in progress"
          description="Start a course from the catalog and it will show up here."
          action={<Button asChild size="sm"><Link to="/courses">Browse courses</Link></Button>}
        />
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3">
          {rows.slice(0, 6).map(({ course, progress }) => (
            <ContinueCard key={course.id} course={course} progress={progress} outline={outlines[course.id]} />
          ))}
        </div>
      )}
    </Panel>
  );
}
