// Scores a quiz by per-question `marks` (default 1).
export default function scoreQuiz(questions = [], answers = {}, passingScore = 70) {
  let score = 0;
  let total = 0;
  const review = questions.map((q) => {
    const marks = Number(q.marks) || 1;
    const selected = answers[q.id] ?? null;
    const isCorrect = selected != null && selected === q.correct_answer;
    total += marks;
    if (isCorrect) score += marks;
    return { question_id: q.id, selected, correct_answer: q.correct_answer, is_correct: isCorrect, marks };
  });
  const percentage = total ? Math.round((score / total) * 100) : 0;
  return { score, total, percentage, passed: percentage >= passingScore, answers: review };
}
