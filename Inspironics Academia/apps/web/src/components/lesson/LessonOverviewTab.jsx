import ReactMarkdown from 'react-markdown';
import { CheckCircle2, Lightbulb, Target } from 'lucide-react';
import TranscriptToggle from '@/components/lesson/TranscriptToggle';

const toPoints = (text = '') =>
  String(text)
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

function Section({ icon: Icon, title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 font-semibold"><Icon className="w-4 h-4 text-primary" />{title}</h3>
      {children}
    </section>
  );
}

export default function LessonOverviewTab({ lesson }) {
  const points = toPoints(lesson.key_points);
  return (
    <div className="space-y-6">
      {lesson.teaching_objective && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-sm">
          <span className="inline-flex items-center gap-2 font-semibold text-primary mb-1"><Target className="w-4 h-4" />Teaching objective</span>
          <p>{lesson.teaching_objective}</p>
        </div>
      )}
      {lesson.summary && <p className="leading-relaxed">{lesson.summary}</p>}
      {points.length > 0 && (
        <Section icon={CheckCircle2} title="Key points">
          <ul className="space-y-2">
            {points.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {lesson.examples && (
        <Section icon={Lightbulb} title="Examples">
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1">
            <ReactMarkdown>{lesson.examples}</ReactMarkdown>
          </div>
        </Section>
      )}
      <TranscriptToggle script={lesson.teaching_script} />
    </div>
  );
}
