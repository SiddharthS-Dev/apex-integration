import { GraduationCap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import CourseRowList from '@/components/mylearning/CourseRowList';
import { isCourseComplete, useCourseOutlines, useMyCourseRows } from '@/components/dashboard/useLearnerData';

export default function MyLearning() {
  const { rows, isLoading } = useMyCourseRows();
  const { data: outlines = {} } = useCourseOutlines(rows.map((r) => r.course.id));

  if (isLoading) return <LoadingState label="Loading your courses…" />;
  const completed = rows.filter((r) => isCourseComplete(r.progress));
  const inProgress = rows.filter((r) => !isCourseComplete(r.progress));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader icon={GraduationCap} title="My learning" description="Every course you've started, in one place." />
      <Tabs defaultValue="in-progress">
        <TabsList>
          <TabsTrigger value="in-progress">In progress ({inProgress.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completed.length})</TabsTrigger>
          <TabsTrigger value="all">All ({rows.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="in-progress" className="mt-6">
          <CourseRowList rows={inProgress} outlines={outlines} emptyTitle="No courses in progress" emptyDescription="Start a course to see it here." />
        </TabsContent>
        <TabsContent value="completed" className="mt-6">
          <CourseRowList rows={completed} outlines={outlines} emptyTitle="No completed courses yet" emptyDescription="Finish every lesson or pass a final test to complete a course." />
        </TabsContent>
        <TabsContent value="all" className="mt-6">
          <CourseRowList rows={rows} outlines={outlines} emptyTitle="You haven't started any courses" emptyDescription="Explore the catalog to begin learning." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
