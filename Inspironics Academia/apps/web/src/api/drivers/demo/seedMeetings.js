import { addDays, parseTranscript, speakerStats } from '@academy/shared';

// Demo meetings: a published release-readiness review with a full analysis (as the AI provider would write
// it), and a stand-up transcript waiting for the admin to process and publish.

const READINESS = `Checkout v4 Release Readiness Review-{STAMP}-Meeting Recording
{DATE_LINE}
12m 05s

Priya Raman started transcription

Priya Raman   0:04
Morning everyone. The goal today is simple: decide whether checkout v4 is ready for the canary on the twelfth, and if not, what stands in the way.

Arjun Mehta   0:31
Load testing finished on Tuesday. We sustain twelve hundred orders a minute, which is above the target, but p99 latency goes to 1.8 seconds once the payment provider slows down.

Priya Raman   1:12
The SLO is 1.2 seconds at p99, so that is a blocker for the full rollout. Is it a blocker for the canary?

Arjun Mehta   1:40
For a five percent canary I think not, as long as the automatic rollback watches latency as well as errors.

Sofia Alvarez   2:05
From the support side, the new error messages are much clearer. One requirement from the support leads: the order reference must be shown on every failure screen, so customers can quote it.

Priya Raman   2:44
Agreed, that is a must for launch. Lee, the failure screens are yours, right?

Lee Learner   2:52
Yes. I'll add the order reference to all four failure screens by Friday.

Priya Raman   3:20
Good. Next, the runbook. The incident response chapter of the SRE playbook was rewritten last month. Does our checkout runbook follow the new escalation path?

Lee Learner   3:41
Not yet. It still pages the old on-call alias. I can update the runbook to the new escalation path and get it reviewed by the on-call team.

Priya Raman   4:05
Please do that before the canary, it has to be right on day one.

Sofia Alvarez   4:30
I'm worried about the refund flow. If a canary order is refunded by an agent on the old admin tool, we are not sure the refund reaches the new ledger.

Arjun Mehta   5:02
That is a real risk. The ledger sync was only tested with orders created in v4. Mixed traffic during the canary is not covered.

Priya Raman   5:30
Then we need a test for exactly that path. Arjun, can you add an end-to-end test for refunds across both versions before the canary?

Arjun Mehta   5:48
Yes, I will have that by Wednesday.

Priya Raman   6:20
On latency: we decided to put a two-second timeout on the payment provider call with one retry, instead of waiting for the provider to fix their side.

Arjun Mehta   6:41
That works. It keeps p99 inside the SLO at the cost of a few more retries. I'll make the change and rerun the load test.

Sofia Alvarez   7:15
Do we know how many customers saw the old timeout error last month? It would help support plan staffing for the launch week.

Priya Raman   7:38
Good question, I don't have that number. Lee, could you pull that from the dashboards?

Lee Learner   7:52
Sure, I'll share it in the channel tomorrow.

Priya Raman   8:30
Last topic, the feature flag. The flag must default to off in every region, and only the release manager can change it.

Arjun Mehta   8:51
It defaults to off already. Restricting who can change it needs a config change in the flag service. I'll raise the access request today.

Sofia Alvarez   9:20
And customer comms: support needs the FAQ two days before the canary at the latest.

Priya Raman   9:40
Sofia, please own the FAQ draft and send it to me for review by Thursday.

Sofia Alvarez   9:55
Will do.

Priya Raman   10:30
So the decision is: canary at five percent on the twelfth, if the refund test passes and the runbook is updated. Full rollout waits until p99 is under 1.2 seconds in the rerun.

Lee Learner   10:52
One open point: who approves moving the canary from five to twenty-five percent? The playbook says the release manager, but we do not have one named for checkout yet.

Priya Raman   11:20
Fair. That is open, I will confirm with the head of engineering this week.

Priya Raman   11:45
Thanks everyone. I will send the notes after this.`;

const STANDUP = `Platform Team Stand-up-{STAMP}-Meeting Recording
{DATE_LINE}
14m 02s

Arjun Mehta   0:03
Quick one today. Yesterday I finished the retry change for the payment client.

Sofia Alvarez   0:40
The FAQ draft is half done. I'll send it to Priya by Thursday as agreed.

Priya Raman   1:10
Thanks. We decided to keep the canary date. Arjun, can you post the new load test results tomorrow?

Arjun Mehta   1:32
Yes, I will post them tomorrow morning.

Lee Learner   2:05
The runbook update is in review. I'm not sure the on-call team has capacity to review it this week.

Priya Raman   2:40
I'll ask them today. The runbook must be approved before the canary.`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateLine = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}, 10:00AM`;
};
const fill = (text, iso) => text.replace('{STAMP}', `${iso.replace(/-/g, '')}_100000`).replace('{DATE_LINE}', dateLine(iso));

export function addMeetings(add, { admin, learner, today }) {
  const readinessDate = addDays(today, -6);
  const parsed = parseTranscript(fill(READINESS, readinessDate));
  const meeting = add('Meeting', {
    title: 'Checkout v4 Release Readiness Review',
    team: 'Checkout',
    meeting_date: readinessDate,
    file_name: `Checkout v4 Release Readiness Review-${readinessDate.replace(/-/g, '')}_100000-Meeting Recording.docx`,
    file_type: 'docx', file_size: 48_200, file_url: 'demo:seed-readiness', source: 'dropbox',
    dropbox_path: '/Meetings/Checkout/Checkout v4 Release Readiness Review.docx',
    status: 'published', progress: 100, published_date: addDays(today, -5), analysis_method: 'ai',
    duration_minutes: 12,
    participants: parsed.participants,
    speaker_stats: speakerStats(parsed.segments, 12 * 60 + 5),
    purpose: 'Decide whether checkout v4 is ready for a 5% canary on the 12th, and list what blocks it.',
    summary: 'Load testing shows checkout v4 handles 1,200 orders a minute, but p99 latency reaches 1.8 s when the payment provider slows, above the 1.2 s SLO. The team agreed a 5% canary can go ahead on the 12th if the cross-version refund test passes and the checkout runbook follows the playbook\'s new escalation path; the full rollout waits for latency to meet the SLO. A two-second payment timeout with one retry was chosen to bring p99 down. Support needs the order reference on every failure screen and the customer FAQ two days before the canary. Who approves widening the canary is still open.',
    themes: [
      { title: 'Ship behind a guarded canary', detail: 'The canary is acceptable before the latency fix because automatic rollback will watch latency as well as errors, limiting the blast radius to 5% of orders.' },
      { title: 'Latency is the gate for full rollout', detail: 'p99 of 1.8 s under provider slowdowns breaks the 1.2 s SLO. The team chose to protect the SLO on its own side (timeout + retry) instead of waiting for the provider.' },
      { title: 'Operational readiness equals code readiness', detail: 'The runbook must follow the rewritten incident-response escalation path from day one; an outdated on-call alias is treated as a launch blocker.' },
      { title: 'Design for the support conversation', detail: 'Order references on every failure screen and an FAQ ahead of launch let support resolve canary issues quickly.' },
    ],
    decisions: [
      { decision: 'Run a 5% canary on the 12th, conditional on the refund test passing and the runbook update', rationale: 'Real traffic signal with a small blast radius; rollback watches latency and errors.', owner: 'Priya Raman' },
      { decision: 'Put a 2-second timeout with one retry on the payment provider call', rationale: 'Keeps p99 inside the SLO without depending on the provider\'s fix.', owner: 'Priya Raman' },
      { decision: 'Hold the full rollout until the load-test rerun shows p99 under 1.2 s', rationale: 'The SLO is the release gate.', owner: 'Priya Raman' },
    ],
    requirements: [
      { text: 'Show the order reference on every checkout failure screen', type: 'functional', priority: 'high', raised_by: 'Sofia Alvarez' },
      { text: 'p99 checkout latency must be at most 1.2 seconds before full rollout', type: 'non_functional', priority: 'high', raised_by: 'Priya Raman' },
      { text: 'The checkout v4 feature flag defaults to off in every region; only the release manager can change it', type: 'technical', priority: 'high', raised_by: 'Priya Raman' },
      { text: 'Customer FAQ available to support at least two days before the canary', type: 'business', priority: 'medium', raised_by: 'Sofia Alvarez' },
    ],
    open_questions: [
      { question: 'Who approves moving the canary from 5% to 25%? No release manager is named for checkout yet.', owner: 'Priya Raman' },
      { question: 'How many customers saw the old timeout error last month (for launch-week support staffing)?', owner: 'Lee Learner' },
      { question: 'Does a refund issued from the old admin tool reach the new ledger for canary orders?', owner: 'Arjun Mehta' },
    ],
    risks: [
      { risk: 'Refunds on canary orders made in the old admin tool may not reach the new ledger', impact: 'high', mitigation: 'End-to-end refund test across both versions before the canary.' },
      { risk: 'Payment provider slowdowns push p99 latency above the SLO', impact: 'medium', mitigation: '2-second timeout with one retry; latency-based automatic rollback during the canary.' },
    ],
    action_item_count: 6,
  }, 5, admin.id);
  add('MeetingTranscript', { meeting_id: meeting.id, segments: parsed.segments, published: true }, 5, admin.id);

  const base = { meeting_id: meeting.id, meeting_title: meeting.title, meeting_date: readinessDate, published: true };
  const quote = (needle) => parsed.segments.find((s) => s.text.includes(needle));
  [
    { task: 'Add the order reference to all four checkout failure screens', owner: learner, due_date: addDays(today, -2), due_text: 'by Friday', priority: 'high', status: 'in_progress', q: 'order reference to all four' },
    { task: 'Update the checkout runbook to the new escalation path and get on-call review', owner: learner, due_date: addDays(today, 1), due_text: 'before the canary', priority: 'high', status: 'open', q: 'update the runbook' },
    { task: 'Share last month\'s count of customers who saw the old timeout error', owner: learner, due_date: addDays(today, -5), due_text: 'tomorrow', priority: 'medium', status: 'done', completed_date: addDays(today, -5), q: 'share it in the channel' },
    { task: 'Add an end-to-end refund test across v3 and v4 orders', owner_name: 'Arjun Mehta', due_date: addDays(today, -1), due_text: 'by Wednesday', priority: 'high', status: 'open', q: 'end-to-end test for refunds' },
    { task: 'Set the payment call to a 2 s timeout with one retry and rerun the load test', owner_name: 'Arjun Mehta', due_date: addDays(today, 3), due_text: '', priority: 'high', status: 'in_progress', q: 'make the change and rerun' },
    { task: 'Draft the customer FAQ and send it to Priya for review', owner_name: 'Sofia Alvarez', due_date: addDays(today, 2), due_text: 'by Thursday', priority: 'medium', status: 'open', q: 'own the FAQ draft' },
  ].forEach(({ owner, owner_name: ownerName, q, ...item }) => {
    const seg = quote(q);
    add('ActionItem', {
      ...base, ...item,
      owner_name: owner ? owner.full_name : ownerName,
      owner_user_id: owner ? owner.id : '',
      source_quote: seg?.text || '',
      source_time: seg?.start ?? undefined,
    }, 5, admin.id);
  });

  // Waiting for review: uploaded from Dropbox, not processed yet. Its text sits in the demo-only
  // side table so "Process" works like a real upload.
  const standupDate = addDays(today, -1);
  const standup = add('Meeting', {
    team: 'Platform',
    title: 'Platform Team Stand-up',
    meeting_date: standupDate,
    file_name: `Platform Team Stand-up-${standupDate.replace(/-/g, '')}_100000-Meeting Recording.docx`,
    file_type: 'docx', file_size: 12_400, file_url: 'demo:seed-standup', source: 'dropbox',
    dropbox_path: '/Meetings/Platform/Platform Team Stand-up.docx', status: 'uploaded', progress: 0,
  }, 1, admin.id);

  return { meeting, sources: [{ meeting_id: standup.id, text: fill(STANDUP, standupDate), file_name: standup.file_name }] };
}
