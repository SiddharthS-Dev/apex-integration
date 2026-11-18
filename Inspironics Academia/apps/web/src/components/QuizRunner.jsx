import { useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { HelpCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import EmptyState from '@/components/EmptyState';
import QuizProgressHeader from '@/components/quiz/QuizProgressHeader';
import QuizQuestion from '@/components/quiz/QuizQuestion';
import QuizNav from '@/components/quiz/QuizNav';
import QuizResults from '@/components/quiz/QuizResults';

// Runs a quiz and hands the answers to `grade`, which submits them to the server and resolves to
// { score, total, percentage, passed, answers: [{ question_id, selected, correct_answer, explanation,
// is_correct }] }. Learners' questions arrive without their answers, so the browser never scores.
export default function QuizRunner({ questions = [], title, passingScore = 70, durationMinutes, grade, onComplete, resultActions }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  if (!questions.length) {
    return <EmptyState icon={HelpCircle} title="No questions yet" description="Questions for this quiz haven't been published." />;
  }

  const submit = async () => {
    if (result || submitting) return;
    const list = questions.map((q) => ({ question_id: q.id, selected: answersRef.current[q.id] ?? null }));
    setSubmitting(true);
    try {
      const r = await grade(list);
      setResult(r);
      if (r.passed) confetti({ particleCount: 140, spread: 75, origin: { y: 0.6 } });
      onComplete?.(r);
    } catch (e) {
      toast.error(e?.message || 'Could not submit your answers — try again');
    } finally {
      setSubmitting(false);
    }
  };
  const retry = () => {
    setIndex(0);
    setAnswers({});
    setResult(null);
    setAttempt((a) => a + 1);
  };

  if (result) {
    return (
      <QuizResults result={result} questions={questions} passingScore={result.passing_score ?? passingScore} onRetry={retry}>
        {resultActions}
      </QuizResults>
    );
  }

  const q = questions[index];
  return (
    <div key={attempt}>
      <QuizProgressHeader
        title={title} index={index} count={questions.length} answered={Object.keys(answers).length}
        durationMinutes={durationMinutes} onExpire={submit}
      />
      <QuizQuestion question={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
      <QuizNav
        index={index} count={questions.length} canSubmit={Object.keys(answers).length > 0 && !submitting}
        onPrev={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
        onSubmit={submit}
      />
      {submitting && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking your answers…</p>}
    </div>
  );
}
