import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/admin/StatusBadge';
import SourceRef from '@/components/admin/SourceRef';
import DisabledReason from '@/components/DisabledReason';
import useAppConfig, { AI_DISABLED_REASON } from '@/lib/useAppConfig';

export default function LessonReviewHeader({ lesson, module, actions }) {
  const { pending } = actions;
  const { ai_enabled: ai } = useAppConfig();
  const busy = !!pending || lesson.status === 'generating';
  const hasContent = !!lesson.teaching_script;
  const spin = (key, Icon) => (pending === key ? <Loader2 className="animate-spin" /> : <Icon />);

  return (
    <div className="space-y-3 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {module && <div className="text-xs text-muted-foreground mb-0.5">{module.title}</div>}
          <h2 className="text-lg font-semibold">{lesson.title}</h2>
        </div>
        <StatusBadge status={lesson.status} />
      </div>
      <SourceRef playbook={lesson.source_playbook} chapter={lesson.source_chapter} section={lesson.source_section} />
      <div className="flex flex-wrap gap-2">
        <DisabledReason reason={ai ? null : AI_DISABLED_REASON}>
          <Button size="sm" variant="outline" disabled={busy || !ai} onClick={actions.generateContent}>
            {spin('content', Sparkles)}
            {hasContent ? 'Regenerate content' : 'Generate content'}
          </Button>
        </DisabledReason>
        <Button
          size="sm"
          disabled={busy || !hasContent || lesson.status === 'approved'}
          onClick={actions.approve}
          className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          {spin('approve', Check)}Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || lesson.status === 'rejected'}
          onClick={actions.reject}
          className="text-rose-700 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
        >
          {spin('reject', X)}Reject
        </Button>
      </div>
    </div>
  );
}
