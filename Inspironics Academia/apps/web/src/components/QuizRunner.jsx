import { useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { HelpCircle } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import QuizProgressHeader from '@/components/quiz/QuizProgressHeader';
import QuizQuestion from '@/components/quiz/QuizQuestion';
import QuizNav from '@/components/quiz/QuizNav';
import QuizResults from '@/components/quiz/QuizResults';
import scoreQuiz from '@/components/quiz/scoreQuiz';

export default function QuizRunner({ questions = [], title, passingScore = 70, durationMinutes, onComplete, resultActions }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  if (!questions.length) {
    return <EmptyState icon={HelpCircle} title="No questions yet" description="Questions for this quiz haven't been published." />;
  }

  const submit = () => {
    if (result) return;
    const r = scoreQuiz(questions, answersRef.current, passingScore);
    setResult(r);
    if (r.passed) confetti({ particleCount: 140, spread: 75, origin: { y: 0.6 } });
    onComplete?.(r);
  };
  const retry = () => {
    setIndex(0);
    setAnswers({});
    setResult(null);
    setAttempt((a) => a + 1);
  };

  if (result) {
    return (
      <QuizResults result={result} questions={questions} passingScore={passingScore} onRetry={retry}>
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
        index={index} count={questions.length} canSubmit={Object.keys(answers).length > 0}
        onPrev={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
        onSubmit={submit}
      />
    </div>
  );
}
