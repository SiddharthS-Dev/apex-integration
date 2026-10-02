import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import StarRating from '@/components/lesson/StarRating';

export default function FeedbackTab({ lesson, courseId }) {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) return toast.error('Please choose a rating');
    setSaving(true);
    try {
      await api.entities.LessonFeedback.create({
        user_id: user.id, lesson_id: lesson.id, course_id: courseId, rating, comment: comment.trim(),
      });
      toast.success('Thanks for your feedback!');
      setRating(0);
      setComment('');
    } catch (err) {
      toast.error(err?.message || 'Could not send feedback');
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <div className="space-y-2">
        <Label>How helpful was this lesson?</Label>
        <StarRating value={rating} onChange={setRating} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lesson-feedback">Comments (optional)</Label>
        <Textarea id="lesson-feedback" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What worked well? What was unclear?" />
      </div>
      <Button type="submit" disabled={saving || !rating}>
        {saving ? <Loader2 className="animate-spin" /> : <Send />}
        Send feedback
      </Button>
    </form>
  );
}
