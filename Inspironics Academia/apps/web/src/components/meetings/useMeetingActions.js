import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useInvalidateMeetings } from '@/lib/meetings';

// Admin actions on a meeting. `busy` holds `${action}:${meetingId}` while one runs.
export default function useMeetingActions() {
  const [busy, setBusy] = useState(null);
  const refresh = useInvalidateMeetings();

  const run = async (key, fn) => {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast.error(e?.message || 'Something went wrong');
      return null;
    } finally {
      setBusy(null);
      refresh();
    }
  };

  return {
    busy,
    process: (m) => run(`process:${m.id}`, async () => {
      const { data } = await api.functions.invoke('processMeeting', { meeting_id: m.id });
      toast.success(`${m.status === 'uploaded' ? 'Analysed' : 'Reprocessed'} “${m.title}”`, {
        description: `${data.action_item_count} action item${data.action_item_count === 1 ? '' : 's'}${data.analysis_method === 'heuristic' ? ' · basic keyword analysis (AI is off)' : ''}. Review, then publish.`,
      });
      return data;
    }),
    publish: (m, publish = true) => run(`publish:${m.id}`, async () => {
      const { data } = await api.functions.invoke('publishMeeting', { meeting_id: m.id, publish });
      toast.success(publish ? 'Published' : 'Unpublished', {
        description: publish ? `Everyone can read the notes${data.notified ? `; ${data.notified} people notified` : ''}.` : 'Only admins can see it now.',
      });
      return data;
    }),
    // The meeting's transcript and action items go with it.
    remove: (m) => run(`delete:${m.id}`, async () => {
      await api.entities.ActionItem.deleteMany({ meeting_id: m.id });
      await api.entities.MeetingTranscript.deleteMany({ meeting_id: m.id });
      await api.entities.Meeting.delete(m.id);
      toast.success(`Deleted “${m.title}”`);
      return true;
    }),
  };
}
