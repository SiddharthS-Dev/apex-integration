import { Award, ClipboardCheck, Route, Video } from 'lucide-react';

const FEATURES = [
  {
    icon: Route,
    title: 'Structured paths',
    body: 'Playbook chapters become ordered modules and lessons, each traceable to its source section.',
    box: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
  {
    icon: Video,
    title: 'AI video lessons',
    body: 'Instructor-style explainers with narration, key points, examples and flashcards.',
    box: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  },
  {
    icon: ClipboardCheck,
    title: 'Assessments',
    body: 'Lesson quizzes, chapter tests and a final exam built around real engineering scenarios.',
    box: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  },
  {
    icon: Award,
    title: 'Verifiable certificates',
    body: 'Pass the final test to earn a certificate with a QR code anyone can verify.',
    box: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
];

export default function FeatureTiles() {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {FEATURES.map(({ icon: Icon, title, body, box }) => (
        <div key={title} className="rounded-2xl border border-border bg-card p-5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${box}`}>
            <Icon className="w-5 h-5" />
          </div>
          <h3 className="font-semibold mt-4">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{body}</p>
        </div>
      ))}
    </section>
  );
}
