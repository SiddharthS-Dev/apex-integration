import { badRequest, notFound } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { notify } from '../notify/index.js';
import { entities } from '../repo/entities.js';
import { listUsers } from '../repo/users.js';

// publishMeeting — makes reviewed meeting notes visible to every signed-in user (or hides them
// again). The transcript and action items follow the meeting. Publishing tells learners the notes
// are out and tells each action item's owner what is theirs; dedupe keys mean republishing does not
// notify anyone twice.
//
// Payload: { meeting_id, publish: true | false }
// Returns: { ok, status, notified }

export default async function publishMeeting(payload = {}) {
  const id = payload?.meeting_id ? String(payload.meeting_id) : '';
  if (!id) throw badRequest('meeting_id is required');
  const publish = payload.publish !== false;
  const meeting = await entities.Meeting.get(id);
  if (!meeting) throw notFound('Meeting not found');
  if (publish && !['needs_review', 'published'].includes(meeting.status)) {
    throw badRequest('Process the transcript first — only analysed meetings can be published.');
  }

  const today = new Date().toISOString().slice(0, 10);
  await entities.Meeting.update(id, publish ? { status: 'published', published_date: meeting.published_date || today } : { status: 'needs_review' });
  const [transcripts, items] = await Promise.all([
    entities.MeetingTranscript.filter({ meeting_id: id }),
    entities.ActionItem.filter({ meeting_id: id }, null, 1000),
  ]);
  await Promise.all([
    ...transcripts.map((t) => entities.MeetingTranscript.update(t.id, { published: publish })),
    ...items.map((a) => entities.ActionItem.update(a.id, { published: publish })),
  ]);
  if (!publish) return { ok: true, status: 'needs_review', notified: 0 };

  let notified = 0;
  const decisions = Array.isArray(meeting.decisions) ? meeting.decisions.length : 0;
  for (const u of await listUsers()) {
    if (u.disabled || u.role === 'admin') continue;
    if (await notify(u.id, 'meeting_published', {
      meeting_id: id, meeting_title: meeting.title, meeting_date: meeting.meeting_date, action_count: items.length, decision_count: decisions,
    }, `meeting_published:${id}:${u.id}`)) notified += 1;
  }
  for (const a of items) {
    if (!a.owner_user_id || ['done', 'cancelled'].includes(a.status)) continue;
    if (await notify(a.owner_user_id, 'action_item_assigned', {
      meeting_id: id, meeting_title: meeting.title, task: a.task, due_date: a.due_date,
    }, `action_item_assigned:${a.id}:${a.owner_user_id}`)) notified += 1;
  }
  log.info('meeting.published', { meeting_id: id, action_items: items.length, notified });
  return { ok: true, status: 'published', notified };
}
