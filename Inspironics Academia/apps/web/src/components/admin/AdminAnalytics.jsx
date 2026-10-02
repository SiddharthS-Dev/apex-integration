import EnrollmentChart from '@/components/admin/dashboard/EnrollmentChart';
import CompletionChart from '@/components/admin/dashboard/CompletionChart';
import QuizPerformanceChart from '@/components/admin/dashboard/QuizPerformanceChart';

// Learning analytics: enrollment trend, completion per course, test performance.
export default function AdminAnalytics({ progress = [], courses = [], attempts = [] }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">Analytics</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <EnrollmentChart progress={progress} />
        <CompletionChart progress={progress} courses={courses} />
        <QuizPerformanceChart attempts={attempts} />
      </div>
    </section>
  );
}
