import { MousePointerClick } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EmptyState from '@/components/EmptyState';
import LessonReviewHeader from '@/components/admin/review/LessonReviewHeader';
import ContentTab from '@/components/admin/review/ContentTab';
import MediaTab from '@/components/admin/review/MediaTab';
import QuizTab from '@/components/admin/review/QuizTab';
import FlashcardsTab from '@/components/admin/review/FlashcardsTab';
import useLessonActions from '@/components/admin/review/useLessonActions';

function LessonReview({ lesson, module, questions, flashcards }) {
  const actions = useLessonActions(lesson, questions, flashcards);
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <LessonReviewHeader lesson={lesson} module={module} actions={actions} />
      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
          <TabsTrigger value="quiz">Quiz ({questions.length})</TabsTrigger>
          <TabsTrigger value="flashcards">Flashcards ({flashcards.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="mt-4">
          <ContentTab key={`${lesson.id}-${lesson.updated_date}`} lesson={lesson} />
        </TabsContent>
        <TabsContent value="media" className="mt-4">
          <MediaTab lesson={lesson} busy={actions.pending === 'media' || lesson.status === 'generating'} onGenerateMedia={actions.generateMedia} onRebuildSlides={actions.rebuildSlides} />
        </TabsContent>
        <TabsContent value="quiz" className="mt-4"><QuizTab questions={questions} /></TabsContent>
        <TabsContent value="flashcards" className="mt-4"><FlashcardsTab flashcards={flashcards} /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function LessonReviewPanel({ lesson, module, questions = [], flashcards = [] }) {
  if (!lesson) {
    return <EmptyState icon={MousePointerClick} title="Select a lesson" description="Choose a lesson from the course outline to review its content." />;
  }
  return <LessonReview key={lesson.id} lesson={lesson} module={module} questions={questions} flashcards={flashcards} />;
}
