import { BookOpen, HelpCircle, Layers, MessageSquare } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TextToVoiceButton from '@/components/TextToVoiceButton';
import LessonOverviewTab from '@/components/lesson/LessonOverviewTab';
import LessonQuizTab from '@/components/lesson/LessonQuizTab';
import FlashcardsTab from '@/components/lesson/FlashcardsTab';
import FeedbackTab from '@/components/lesson/FeedbackTab';

const TABS = [
  { value: 'lesson', label: 'Lesson', icon: BookOpen },
  { value: 'quiz', label: 'Quiz', icon: HelpCircle },
  { value: 'flashcards', label: 'Flashcards', icon: Layers },
  { value: 'feedback', label: 'Feedback', icon: MessageSquare },
];

export default function LessonContentCard({ lesson, courseId }) {
  const speech = [lesson.summary, lesson.key_points].filter(Boolean).join('\n');
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <Tabs defaultValue="lesson">
        <div className="flex items-start justify-between gap-3 mb-5">
          <TabsList className="flex-wrap h-auto">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TextToVoiceButton text={speech} title={lesson.title} />
        </div>
        <TabsContent value="lesson"><LessonOverviewTab lesson={lesson} /></TabsContent>
        <TabsContent value="quiz"><LessonQuizTab lesson={lesson} courseId={courseId} /></TabsContent>
        <TabsContent value="flashcards"><FlashcardsTab lesson={lesson} courseId={courseId} /></TabsContent>
        <TabsContent value="feedback"><FeedbackTab lesson={lesson} courseId={courseId} /></TabsContent>
      </Tabs>
    </div>
  );
}
