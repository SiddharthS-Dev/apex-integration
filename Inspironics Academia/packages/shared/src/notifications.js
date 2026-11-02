// Notification kinds: the in-app text, the link, and which NotificationPreference switch governs the
// email copy. The API turns the same content into email; the demo driver only stores the in-app row.
//
// `pref: null` means the email always goes out (account emails); in-app rows are always created.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtDay = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

export const NOTIFICATION_KINDS = Object.freeze({
  review_due: {
    pref: 'review_reminders',
    build: (d) => ({
      title: `${plural(d.count, 'flashcard')} due for review`,
      body: 'A few minutes of review today keeps what you learned from fading.',
      link: '/review',
    }),
  },
  course_published: {
    pref: 'course_updates',
    build: (d) => ({
      title: `New course: ${d.course_title}`,
      body: d.description || 'A new course is available in the catalog.',
      link: `/courses/${d.course_id}`,
    }),
  },
  certificate_issued: {
    pref: 'certificates',
    build: (d) => ({
      title: `Certificate earned: ${d.course_title}`,
      body: `You passed with ${d.score}%. Certificate ${d.certificate_id}${d.expires_date ? ` is valid until ${fmtDay(d.expires_date)}` : ''}.`,
      link: `/certificate/${d.course_id}`,
    }),
  },
  recert_required: {
    pref: 'recertification',
    build: (d) => ({
      title: `Recertification needed: ${d.playbook_title}`,
      body: d.reason === 'expired'
        ? `Your certificate has expired. Recertify by ${fmtDay(d.due_date)}.`
        : `The playbook was updated (${plural(d.changed_count || 0, 'chapter')} changed). Review what changed and recertify by ${fmtDay(d.due_date)}.`,
      link: '/certificates',
    }),
  },
  recert_due_soon: {
    pref: 'recertification',
    build: (d) => ({
      title: `Recertification due ${fmtDay(d.due_date)}`,
      body: `${d.playbook_title}: ${plural(d.days_left, 'day')} left to recertify.`,
      link: '/certificates',
    }),
  },
  recert_overdue: {
    pref: 'recertification',
    build: (d) => ({
      title: `Recertification overdue: ${d.playbook_title}`,
      body: `It was due ${fmtDay(d.due_date)}. Your certificate is not current until you recertify.`,
      link: '/certificates',
    }),
  },
  certificate_expiring: {
    pref: 'recertification',
    build: (d) => ({
      title: `Certificate expires ${fmtDay(d.expires_date)}`,
      body: `${d.course_title}: your certificate expires in ${plural(d.days_left, 'day')}.`,
      link: '/certificates',
    }),
  },
  certificate_expired: {
    pref: 'recertification',
    build: (d) => ({
      title: `Certificate expired: ${d.course_title}`,
      body: `It expired on ${fmtDay(d.expires_date)}. Recertify by ${fmtDay(d.due_date)}.`,
      link: '/certificates',
    }),
  },
  meeting_published: {
    pref: 'meetings',
    build: (d) => ({
      title: `Meeting notes: ${d.meeting_title}`,
      body: `${d.meeting_date ? `${fmtDay(d.meeting_date)} · ` : ''}${plural(d.action_count || 0, 'action item')}${d.decision_count ? `, ${plural(d.decision_count, 'decision')}` : ''}.`,
      link: `/meetings/${d.meeting_id}`,
    }),
  },
  action_item_assigned: {
    pref: 'action_items',
    build: (d) => ({
      title: `Action item for you: ${d.task}`,
      body: `From "${d.meeting_title}"${d.due_date ? `, due ${fmtDay(d.due_date)}` : ''}.`,
      link: `/meetings/${d.meeting_id}`,
    }),
  },
  action_item_due: {
    pref: 'action_items',
    build: (d) => ({
      title: `Due ${fmtDay(d.due_date)}: ${d.task}`,
      body: `Action item from "${d.meeting_title}".`,
      link: '/action-items',
    }),
  },
  action_item_overdue: {
    pref: 'action_items',
    build: (d) => ({
      title: `Overdue: ${d.task}`,
      body: `It was due ${fmtDay(d.due_date)} (from "${d.meeting_title}"). Update it or mark it done.`,
      link: '/action-items',
    }),
  },
  recert_completed: {
    pref: 'certificates',
    build: (d) => ({
      title: `Recertified: ${d.playbook_title}`,
      body: `Your new certificate ${d.certificate_id} replaces the previous one.`,
      link: '/certificates',
    }),
  },
});

export const NOTIFICATION_PREFS = Object.freeze([
  { key: 'review_reminders', label: 'Flashcard review reminders', hint: 'A daily email when cards are due' },
  { key: 'course_updates', label: 'New courses', hint: 'When a course is published' },
  { key: 'recertification', label: 'Recertification', hint: 'Playbook changes, due dates and expiring certificates' },
  { key: 'certificates', label: 'Certificates', hint: 'When you earn or renew a certificate' },
  { key: 'meetings', label: 'Meeting notes', hint: 'When notes from a meeting are published' },
  { key: 'action_items', label: 'Action items', hint: 'Assigned to you, due tomorrow, or overdue' },
]);

/** { kind, title, body, link } for a notification of `kind` built from `data`. */
export function buildNotification(kind, data = {}) {
  const spec = NOTIFICATION_KINDS[kind];
  if (!spec) throw new Error(`Unknown notification kind ${kind}`);
  return { kind, ...spec.build(data) };
}

/** Whether `prefs` (a NotificationPreference row, or null for defaults) allow emailing `kind`. */
export function emailAllowed(kind, prefs) {
  const spec = NOTIFICATION_KINDS[kind];
  if (!spec) return false;
  if (prefs?.email_enabled === false) return false;
  return !spec.pref || prefs?.[spec.pref] !== false;
}
