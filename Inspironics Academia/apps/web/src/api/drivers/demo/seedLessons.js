// Teaching content for the demo academy's published course ("Reliability Engineering Foundations"),
// written as if generated from the "Site Reliability Engineering Playbook" and then reviewed.
// q: [question, options, correct answer, explanation, difficulty, cognitive level]
// f: [front, back, difficulty]

export const RELIABILITY_MODULES = [
  {
    title: 'Measuring Reliability with SLOs',
    description: 'Define what "reliable" means for users and turn it into measurable targets and budgets.',
    source_chapters: '1. Service Level Objectives',
    lessons: [
      {
        title: 'Choosing Service Level Indicators',
        video_type: 'concept',
        source_chapter: '1. Service Level Objectives',
        source_section: '1.1 User-centric indicators',
        teaching_objective: 'Select service level indicators (SLIs) that reflect what users actually experience, and express them as a ratio of good events to valid events.',
        teaching_script: `Welcome. Before we can say a service is reliable, we have to agree on what we are measuring. That is the job of a service level indicator, or SLI.

An SLI is a carefully defined measurement of some aspect of the service as users experience it. The playbook recommends expressing every SLI the same way: the number of good events divided by the number of valid events, multiplied by one hundred. That gives you a percentage between zero and one hundred, where one hundred is perfect.

Why a ratio? Because it is easy to compare across services, easy to aggregate over time, and it naturally ignores traffic volume. A checkout API serving ten requests a minute and one serving ten thousand can both be judged on the same scale.

The most common indicators are availability, meaning the proportion of requests that succeed; latency, meaning the proportion of requests served faster than a threshold; and freshness or correctness for data pipelines.

Here is the key idea: measure as close to the user as you can. CPU usage and queue depth are useful for debugging, but users never feel CPU. They feel slow pages and failed payments. Measure at the load balancer or with client telemetry, not only on the server itself.

Finally, be precise about what counts as valid. Health checks, requests from internal load tests, and client errors caused by bad input are usually excluded. Write the definition down, because an SLI that two teams interpret differently is worse than no SLI at all.`,
        summary: 'An SLI measures user experience as good events divided by valid events. Prefer availability, latency and freshness measured close to the user, and document exactly which events are valid.',
        key_points: 'An SLI is good events / valid events × 100\nMeasure what users feel, not internal resource metrics\nAvailability, latency and freshness are the common SLI families\nMeasure as close to the user as possible (load balancer or client)\nWrite down which events are valid and which are excluded',
        examples: 'Checkout availability SLI: HTTP responses with status < 500 at the edge load balancer ÷ all responses, excluding /healthz.\nSearch latency SLI: search requests completed in under 300 ms ÷ all search requests.\nReporting pipeline freshness SLI: minutes in which the dashboard data is less than 15 minutes old ÷ all minutes.',
        q: [
          ['How does the playbook recommend expressing every SLI?', ['As an absolute count of errors per day', 'As good events divided by valid events, as a percentage', 'As the average CPU utilisation of the service', 'As the p99 latency in milliseconds'], 'As good events divided by valid events, as a percentage', 'A ratio of good to valid events is comparable across services and independent of traffic volume.', 'basic', 'recall'],
          ['Which of these is the best SLI for a public web API?', ['Proportion of requests that succeed at the load balancer', 'Average memory usage of the API pods', 'Number of deploys per week', 'Length of the job queue'], 'Proportion of requests that succeed at the load balancer', 'Users feel failed requests, not memory usage; the edge is close to the user.', 'basic', 'understanding'],
          ['Why should health-check requests usually be excluded from the valid events?', ['They are too slow to measure', 'They do not represent real user traffic and would inflate the SLI', 'They always fail', 'They are counted twice by the load balancer'], 'They do not represent real user traffic and would inflate the SLI', 'Synthetic traffic that always succeeds makes the service look more reliable than users experience.', 'intermediate', 'understanding'],
          ['A data pipeline refreshes a dashboard every 10 minutes. Which SLI family fits best?', ['Availability', 'Latency', 'Freshness', 'Throughput'], 'Freshness', 'For data pipelines, users care whether the data is recent enough, which is a freshness indicator.', 'intermediate', 'application'],
        ],
        f: [
          ['What is an SLI?', 'A defined measurement of user experience, expressed as good events ÷ valid events × 100.', 'basic'],
          ['Name three common SLI families.', 'Availability, latency and freshness (or correctness for data).', 'basic'],
          ['Where should SLIs be measured?', 'As close to the user as possible — the edge load balancer or client telemetry.', 'intermediate'],
        ],
      },
      {
        title: 'SLOs and Error Budgets',
        video_type: 'deep_dive',
        source_chapter: '1. Service Level Objectives',
        source_section: '1.2 Targets and error budgets',
        teaching_objective: 'Set a service level objective (SLO) over a rolling window and use the resulting error budget to balance feature velocity against reliability work.',
        teaching_script: `In the previous lesson we defined indicators. Now we turn an indicator into a promise: the service level objective, or SLO.

An SLO is a target value for an SLI over a time window. For example: ninety-nine point nine percent of checkout requests succeed, measured over a rolling twenty-eight day window. The playbook prefers rolling windows over calendar months, because a rolling window never "resets" and hides a bad week.

Notice that the target is not one hundred percent. One hundred percent is the wrong goal for almost every service. It is impossibly expensive, it freezes change, and users cannot tell the difference between one hundred and ninety-nine point nine nine because their own phone and network fail more often than that.

The gap between the target and perfection is the error budget. With a ninety-nine point nine percent SLO, the budget is zero point one percent of requests. Over twenty-eight days that is roughly forty minutes of full outage, or a much longer period of partial degradation.

The error budget is what makes SLOs useful in practice. While budget remains, teams ship features freely and take reasonable risks. When the budget is exhausted, the playbook's error budget policy applies: feature releases pause, and the team prioritises reliability work until the service is back within its objective.

This turns an emotional argument between product and operations into a data-driven one. Nobody has to argue whether the service is "reliable enough". The budget tells you.`,
        summary: 'An SLO is a target for an SLI over a rolling window. The shortfall from 100% is the error budget; while budget remains teams ship, and when it is spent the error budget policy prioritises reliability.',
        key_points: 'SLO = target value for an SLI over a time window\nPrefer rolling windows (e.g. 28 days) to calendar months\n100% is the wrong target — it is costly and blocks change\nError budget = 100% − SLO target\nWhen the budget is exhausted, releases pause per the error budget policy',
        examples: '99.9% availability over 28 days → error budget of 0.1% ≈ 40 minutes of total outage.\n99.5% of search requests under 300 ms over 28 days → 0.5% of requests may be slower.\nAfter a bad deploy consumes 80% of the budget in a day, the team freezes feature releases and fixes the rollout process.',
        q: [
          ['What is an error budget?', ['The money set aside for incident response', 'The allowed shortfall between the SLO target and 100%', 'The number of bugs allowed per release', 'The time allotted for postmortems'], 'The allowed shortfall between the SLO target and 100%', 'With a 99.9% SLO, 0.1% of events may be bad — that is the error budget.', 'basic', 'recall'],
          ['Why does the playbook prefer rolling windows over calendar months?', ['They are easier to compute in spreadsheets', 'A rolling window never resets, so a bad week stays visible', 'Calendar months are too short', 'Rolling windows always show higher reliability'], 'A rolling window never resets, so a bad week stays visible', 'Calendar resets can hide recent problems; rolling windows reflect the last N days continuously.', 'intermediate', 'understanding'],
          ['A service has a 99.9% SLO over 28 days. Roughly how much total outage fits in the budget?', ['About 4 minutes', 'About 40 minutes', 'About 4 hours', 'About 1 day'], 'About 40 minutes', '0.1% of 28 days (40,320 minutes) is about 40 minutes.', 'intermediate', 'application'],
          ['The error budget is exhausted halfway through the window. What does the error budget policy say?', ['Lower the SLO target so the budget is restored', 'Pause feature releases and prioritise reliability work', 'Ignore it until the next window starts', 'Double the on-call rotation'], 'Pause feature releases and prioritise reliability work', 'The policy trades velocity for reliability until the service is back within its objective.', 'advanced', 'application'],
        ],
        f: [
          ['What is an SLO?', 'A target value for an SLI over a time window, e.g. 99.9% success over 28 rolling days.', 'basic'],
          ['How do you compute the error budget?', '100% minus the SLO target (e.g. 100% − 99.9% = 0.1%).', 'basic'],
          ['Why is 100% the wrong reliability target?', 'It is prohibitively expensive, blocks all change, and users cannot perceive the difference.', 'intermediate'],
        ],
      },
      {
        title: 'Alerting on Burn Rate',
        video_type: 'example',
        source_chapter: '1. Service Level Objectives',
        source_section: '1.3 SLO-based alerting',
        teaching_objective: 'Configure multi-window burn-rate alerts that page for fast, significant budget consumption and open tickets for slow burns.',
        teaching_script: `Once you have an SLO and an error budget, you can build alerts that page people only when users are genuinely at risk. The playbook calls this burn-rate alerting.

Burn rate is how fast you are consuming the error budget relative to the rate that would exactly use it up by the end of the window. A burn rate of one means you will finish the window with zero budget left. A burn rate of ten means you will exhaust a twenty-eight day budget in under three days.

Alerting on raw error rate is noisy. A thirty-second spike can page someone at three in the morning even though it barely touched the budget. Alerting on burn rate ties the page to user impact.

The recommended pattern uses two windows per alert: a long window to confirm the problem is significant, and a short window to confirm it is still happening. For example, page when the burn rate is above fourteen point four over both the last hour and the last five minutes. That combination detects a serious outage within minutes and stops paging quickly once it is fixed.

Slower burns still matter, but they do not need to wake anyone up. A burn rate above one over three days, confirmed over six hours, should open a ticket for the owning team to investigate during working hours.

The result: fewer pages, every page actionable, and a direct line from each alert back to the promise you made to users.`,
        summary: 'Burn rate measures how fast the error budget is being consumed. Use multi-window alerts: page on fast burns confirmed over long and short windows, and open tickets for slow burns.',
        key_points: 'Burn rate 1 = budget exactly used by the end of the window\nRaw error-rate alerts are noisy; burn-rate alerts track user impact\nUse a long window (significance) and a short window (still happening)\nFast burn (e.g. 14.4× over 1 h and 5 min) → page\nSlow burn (e.g. 1× over 3 days and 6 h) → ticket',
        examples: 'Page: checkout burn rate > 14.4 over 1 h AND > 14.4 over 5 min — about 2% of the monthly budget spent in an hour.\nTicket: burn rate > 1 over 3 days AND over 6 h — a slow leak such as a gradually failing dependency.\nA 30-second spike to 5% errors does not trip the 1-hour window, so nobody is paged.',
        q: [
          ['What does a burn rate of 1 mean?', ['The service is completely down', 'The budget will be exactly used up by the end of the window', 'One error per minute is occurring', 'The SLO has been met with budget to spare'], 'The budget will be exactly used up by the end of the window', 'Burn rate is relative to the pace that exactly consumes the budget over the window.', 'basic', 'recall'],
          ['Why use both a long and a short window in one alert?', ['To double the number of pages', 'The long window confirms significance; the short window confirms it is still happening', 'Because monitoring tools require two windows', 'To measure latency and availability together'], 'The long window confirms significance; the short window confirms it is still happening', 'This detects serious problems fast and stops alerting soon after recovery.', 'intermediate', 'understanding'],
          ['A slow burn of 1.2× over three days is detected. What is the recommended response?', ['Page the on-call engineer immediately', 'Open a ticket for the owning team', 'Roll back the last deploy automatically', 'Ignore it'], 'Open a ticket for the owning team', 'Slow burns matter but are not urgent enough to wake someone up.', 'intermediate', 'application'],
          ['Which problem does burn-rate alerting mainly solve compared to raw error-rate alerts?', ['It removes the need for SLOs', 'It reduces noisy pages by tying alerts to budget impact', 'It makes dashboards load faster', 'It eliminates the on-call rotation'], 'It reduces noisy pages by tying alerts to budget impact', 'Short spikes barely affect the budget and no longer page anyone.', 'advanced', 'analysis'],
        ],
        f: [
          ['What is burn rate?', 'How fast the error budget is consumed relative to the pace that would exactly exhaust it over the window.', 'basic'],
          ['Fast burn vs slow burn response?', 'Fast burn → page on-call. Slow burn → open a ticket.', 'intermediate'],
          ['Why two windows per alert?', 'Long window proves significance; short window proves it is still happening.', 'intermediate'],
        ],
      },
    ],
  },
  {
    title: 'Incident Response and Safe Change',
    description: 'Run calm, well-coordinated incidents, learn from them without blame, and ship changes safely.',
    source_chapters: '2. Incident Response, 3. Change Management',
    lessons: [
      {
        title: 'Incident Roles and Command',
        video_type: 'concept',
        source_chapter: '2. Incident Response',
        source_section: '2.1 Roles during an incident',
        teaching_objective: 'Assign the incident commander, operations lead and communications lead roles, and explain why separating coordination from hands-on repair shortens outages.',
        teaching_script: `When a serious incident starts, the biggest risk is not the bug. It is confusion. Five engineers debugging the same symptom, nobody updating customers, and two people rolling back different things at once.

The playbook solves this with clearly defined roles. The first is the incident commander. The commander does not fix anything. Their job is to hold the big picture: declare severity, assign roles, decide on the next action, and keep a running timeline.

The operations lead, sometimes called the ops lead, directs the hands-on work. They coordinate the engineers who are investigating and mitigating, and they are the only person who approves changes to production during the incident.

The communications lead keeps everyone else informed: status page updates, messages to support and leadership, and a regular cadence of updates, typically every thirty minutes, even when the update is "no change".

Separating these roles matters because debugging needs deep focus while coordination needs broad attention. One person cannot do both well under pressure.

Two more principles. First, mitigate before you diagnose. Rolling back or failing over to restore service comes before understanding the root cause. Second, handovers are explicit. If the commander needs to step away, they say so in the incident channel and name their replacement, who confirms. Nothing is ever assumed.`,
        summary: 'Incidents run on three roles: the incident commander coordinates, the operations lead directs hands-on repair, and the communications lead keeps stakeholders updated. Mitigate first, diagnose later, and hand over roles explicitly.',
        key_points: 'Incident commander coordinates and decides — does not debug\nOperations lead directs and approves production changes\nCommunications lead posts regular updates (e.g. every 30 minutes)\nMitigate first (rollback, failover), find root cause later\nRole handovers are stated explicitly and confirmed',
        examples: 'Checkout errors spike: the commander declares SEV-2, names an ops lead and a comms lead, and opens a timeline document.\nThe ops lead sees a deploy 10 minutes before the spike and approves an immediate rollback before anyone reads the diff.\nThe comms lead posts "Investigating elevated checkout errors — next update in 30 minutes" to the status page.',
        q: [
          ['What is the incident commander\'s main job?', ['Writing the fix for the bug', 'Coordinating the response and deciding next actions', 'Updating the public status page', 'Approving the postmortem'], 'Coordinating the response and deciding next actions', 'The commander holds the big picture and deliberately stays out of hands-on debugging.', 'basic', 'recall'],
          ['During an incident, who approves changes to production?', ['Any engineer on the call', 'The communications lead', 'The operations lead', 'The customer support team'], 'The operations lead', 'A single approver prevents conflicting changes, like two simultaneous rollbacks.', 'basic', 'recall'],
          ['A deploy went out 10 minutes before errors started. What should the team do first?', ['Read the full diff to find the root cause', 'Roll back the deploy to restore service', 'Schedule a postmortem', 'Wait to see if errors stop on their own'], 'Roll back the deploy to restore service', 'Mitigate first, diagnose later — restoring service limits user impact.', 'intermediate', 'application'],
          ['Why does the playbook separate coordination from hands-on repair?', ['To create more job titles', 'Deep debugging and broad coordination compete for attention under pressure', 'Because commanders are not engineers', 'To reduce the number of people on the call'], 'Deep debugging and broad coordination compete for attention under pressure', 'One person cannot keep the big picture while deep in a debugger.', 'advanced', 'analysis'],
        ],
        f: [
          ['Three core incident roles?', 'Incident commander, operations lead, communications lead.', 'basic'],
          ['Mitigate or diagnose first?', 'Mitigate first (rollback, failover); diagnose the root cause after service is restored.', 'basic'],
          ['How are incident roles handed over?', 'Explicitly in the incident channel, naming the replacement, who confirms.', 'intermediate'],
        ],
      },
      {
        title: 'Blameless Postmortems',
        video_type: 'deep_dive',
        source_chapter: '2. Incident Response',
        source_section: '2.3 Learning from incidents',
        teaching_objective: 'Write a blameless postmortem that captures impact, timeline, contributing factors and owned action items, and explain why blame reduces reliability.',
        teaching_script: `Every significant incident ends with a postmortem. Its purpose is learning, not punishment, and the playbook is firm that postmortems must be blameless.

Blameless does not mean nobody is accountable. It means we assume everyone acted reasonably given the information and tools they had at the time. If an engineer ran a command that deleted a table, the useful question is not "who did this?" but "why did our system make that command so easy to run against production?"

Blame has a measurable cost. When people fear punishment, they hide mistakes, delay escalation, and share less detail. Incidents last longer and the same failures repeat.

A good postmortem has five parts. The summary explains what happened in two or three sentences. The impact quantifies it: duration, users affected, error budget consumed. The timeline lists key events with timestamps, including when the problem was detected and when it was mitigated. Contributing factors describe the conditions that allowed the incident; usually there are several, not a single root cause. Finally, action items are specific, have an owner and a due date, and are tracked like any other engineering work.

The playbook sets a deadline: draft within five working days, reviewed in the weekly reliability meeting. An action item without an owner is just a wish.`,
        summary: 'Postmortems are blameless: assume reasonable actions and fix the system. Include summary, impact, timeline, contributing factors and owned, dated action items, drafted within five working days.',
        key_points: 'Blameless means fixing the system, not punishing people\nBlame causes hidden mistakes and slower escalation\nFive parts: summary, impact, timeline, contributing factors, action items\nLook for several contributing factors, not one root cause\nEvery action item has an owner and a due date',
        examples: 'Instead of "Sam dropped the table", write "The admin CLI allowed destructive commands against production without confirmation."\nImpact: 47 minutes, ~12% of checkout requests failed, 65% of the monthly error budget consumed.\nAction item: "Require a confirmation prompt for destructive CLI commands in prod — owner: Platform team, due 14 March."',
        q: [
          ['What does "blameless" mean in a postmortem?', ['Nobody is ever accountable for anything', 'Assume people acted reasonably and focus on fixing the system', 'The postmortem is kept secret', 'Only managers may write the postmortem'], 'Assume people acted reasonably and focus on fixing the system', 'Blamelessness keeps people candid, which is what makes learning possible.', 'basic', 'understanding'],
          ['Which of these is a well-formed action item?', ['Be more careful with deploys', 'Add a confirmation prompt to destructive CLI commands — owner: Platform, due in 2 weeks', 'Investigate stuff', 'Never let this happen again'], 'Add a confirmation prompt to destructive CLI commands — owner: Platform, due in 2 weeks', 'Action items must be specific, owned and dated.', 'intermediate', 'application'],
          ['Why does the playbook talk about contributing factors rather than a single root cause?', ['Root causes are too hard to find', 'Incidents usually result from several conditions combining', 'It makes the document longer', 'Contributing factors are easier to blame on people'], 'Incidents usually result from several conditions combining', 'Complex systems fail through combinations of latent conditions and triggers.', 'intermediate', 'understanding'],
          ['What is the main risk of a blame culture for reliability?', ['Postmortems become too short', 'People hide mistakes and delay escalation, so incidents last longer', 'Engineers write too many action items', 'Dashboards become harder to read'], 'People hide mistakes and delay escalation, so incidents last longer', 'Fear reduces information flow exactly when it matters most.', 'advanced', 'analysis'],
        ],
        f: [
          ['Five parts of a postmortem?', 'Summary, impact, timeline, contributing factors, action items.', 'basic'],
          ['Deadline for a postmortem draft?', 'Within five working days, reviewed in the weekly reliability meeting.', 'intermediate'],
          ['What makes an action item valid?', 'It is specific and has an owner and a due date.', 'basic'],
        ],
      },
      {
        title: 'Progressive Delivery and Rollbacks',
        video_type: 'demonstration',
        source_chapter: '3. Change Management',
        source_section: '3.2 Canary releases and rollback',
        teaching_objective: 'Roll out changes progressively with canaries and feature flags, define automatic rollback criteria, and keep every change reversible.',
        teaching_script: `Most outages are caused by change: a deploy, a configuration update, a schema migration. The playbook does not respond by changing less. It responds by changing safely.

The foundation is progressive delivery. Instead of releasing to everyone at once, a change goes to a small canary first, typically one to five percent of traffic. The canary's SLIs are compared with the stable version. If error rate or latency is worse, the rollout stops automatically. If not, traffic increases in stages, for example five percent, twenty-five percent, then one hundred percent, with a bake time at each stage.

Rollback criteria are defined before the release, not during it. A typical rule: roll back automatically if the canary's error rate is more than twice the baseline for five minutes. Deciding in advance removes the temptation to "give it a few more minutes" while users suffer.

Feature flags separate deploying code from releasing features. Code can ship dark, then be enabled for internal users, then a percentage of customers. Turning a flag off is the fastest rollback there is.

Finally, every change must be reversible. Database migrations follow the expand-and-contract pattern: add the new column, write to both, migrate reads, and only remove the old column in a later release. If you cannot roll it back, you have not finished designing it.`,
        summary: 'Ship changes progressively: canary a small share of traffic, compare SLIs, expand in stages, and roll back automatically on pre-agreed criteria. Use feature flags and expand-and-contract migrations so every change is reversible.',
        key_points: 'Most outages are caused by change — make change safe, not rare\nCanary 1–5% of traffic and compare SLIs with the stable version\nDefine automatic rollback criteria before the release\nFeature flags decouple deploy from release\nUse expand-and-contract migrations so changes stay reversible',
        examples: 'Rollout plan: 5% for 30 min → 25% for 1 h → 100%, halting if canary error rate > 2× baseline for 5 min.\nA new recommendation widget ships behind a flag, enabled for staff first, then 10% of customers.\nRenaming a column: add new column → dual-write → backfill → switch reads → drop old column one release later.',
        q: [
          ['What is a canary release?', ['Releasing to all users at night', 'Sending a small share of traffic to the new version and comparing its SLIs', 'Testing only in a staging environment', 'Releasing without monitoring'], 'Sending a small share of traffic to the new version and comparing its SLIs', 'A canary limits the blast radius while providing real production signal.', 'basic', 'recall'],
          ['When should rollback criteria be defined?', ['During the incident', 'After the postmortem', 'Before the release starts', 'Only for major releases'], 'Before the release starts', 'Pre-agreed criteria remove hesitation while users are affected.', 'basic', 'recall'],
          ['What is the main benefit of feature flags for reliability?', ['They make code run faster', 'They separate deploying code from releasing features, enabling instant rollback', 'They replace the need for tests', 'They reduce the size of the codebase'], 'They separate deploying code from releasing features, enabling instant rollback', 'Turning a flag off is faster and safer than redeploying.', 'intermediate', 'understanding'],
          ['You need to rename a heavily used database column. Which approach keeps the change reversible?', ['Rename the column in one migration during low traffic', 'Expand and contract: add new column, dual-write, migrate reads, drop old column later', 'Drop the table and recreate it', 'Ask users to stop using the feature during the migration'], 'Expand and contract: add new column, dual-write, migrate reads, drop old column later', 'Each step can be rolled back independently, unlike a single rename.', 'advanced', 'application'],
        ],
        f: [
          ['Typical canary share of traffic?', 'About 1–5%, compared against the stable version\'s SLIs.', 'basic'],
          ['Example automatic rollback rule?', 'Roll back if the canary error rate exceeds 2× baseline for 5 minutes.', 'intermediate'],
          ['What is expand-and-contract?', 'Add new schema, dual-write, migrate reads, and remove the old schema in a later release.', 'advanced'],
        ],
      },
    ],
  },
];

// Draft course awaiting review (from the "API Design Standards" playbook).
export const API_DRAFT_MODULE = {
  title: 'Designing Consistent HTTP APIs',
  description: 'Resource naming, versioning and error formats from the API Design Standards.',
  source_chapters: '1. Resource Design, 2. Errors and Versioning',
  lessons: [
    {
      title: 'Resource-Oriented URL Design',
      video_type: 'concept',
      status: 'pending_review',
      source_chapter: '1. Resource Design',
      source_section: '1.1 Naming resources',
      teaching_objective: 'Model an API around nouns (resources) with predictable, plural collection URLs and standard HTTP methods.',
      teaching_script: `Good APIs are predictable. If a developer has seen one of our endpoints, they should be able to guess the rest. The standard achieves this by designing around resources, not actions.

A resource is a noun: an order, a customer, an invoice. Collections use plural names, such as slash orders, and a single item is addressed by its identifier, slash orders slash forty-two. Relationships nest one level at most: slash customers slash seven slash orders.

Actions are expressed with HTTP methods rather than verbs in the URL. GET reads, POST creates, PATCH partially updates, and DELETE removes. So instead of slash create-order, we POST to slash orders.

Use lowercase, hyphenated path segments and camel-free query parameters, and never expose internal implementation details such as table names or service names in the URL. The URL is a contract; the database behind it will change.`,
      summary: 'Design URLs around plural resource nouns, address items by id, nest at most one level, and use HTTP methods for actions.',
      key_points: 'Resources are nouns; collections are plural\nUse HTTP methods for actions, not verbs in URLs\nNest relationships at most one level\nLowercase, hyphenated path segments\nDo not leak implementation details into URLs',
      examples: 'POST /orders instead of POST /createOrder.\nGET /customers/7/orders lists one customer\'s orders.\nPATCH /orders/42 with {"status":"shipped"} updates one field.',
      q: [
        ['Which URL follows the resource-oriented standard for creating an order?', ['POST /orders', 'GET /createOrder', 'POST /order/create', 'PUT /orders/new'], 'POST /orders', 'Create by POSTing to the plural collection.', 'basic', 'recall'],
        ['How deeply should resource relationships be nested?', ['As deep as the data model', 'At most one level', 'Never', 'Exactly three levels'], 'At most one level', 'Deep nesting makes URLs brittle and hard to cache.', 'intermediate', 'understanding'],
      ],
      f: [
        ['Collection naming rule?', 'Use plural nouns, e.g. /orders.', 'basic'],
        ['Where do actions go?', 'In the HTTP method (GET, POST, PATCH, DELETE), not the URL.', 'basic'],
      ],
    },
    {
      title: 'Error Responses and Versioning',
      video_type: 'example',
      status: 'pending_review',
      source_chapter: '2. Errors and Versioning',
      source_section: '2.1 Error format',
      teaching_objective: 'Return errors in the standard machine-readable format and evolve APIs without breaking existing clients.',
      teaching_script: `Clients handle errors far more often than we expect, so errors deserve as much design as successes. The standard requires every error response to use the correct HTTP status code and a consistent JSON body with a stable error code, a human-readable message, and optional details.

Four hundred codes mean the client must change the request; five hundred codes mean the server failed and a retry may help. Never return two hundred with an error inside the body.

For evolution, additive changes such as new optional fields are always allowed. Removing or renaming a field, or changing its type, is a breaking change and requires a new major version in the URL, with the previous version supported for at least twelve months after deprecation is announced.`,
      summary: 'Errors use correct status codes and a consistent JSON body. Additive changes are safe; breaking changes need a new major version with a 12-month deprecation period.',
      key_points: '4xx = client must change the request; 5xx = server failure\nConsistent error body: code, message, details\nNever return 200 with an error body\nAdditive changes are non-breaking\nBreaking changes need a new major version and 12-month deprecation',
      examples: '422 {"code":"invalid_quantity","message":"Quantity must be at least 1"}.\nAdding an optional "gift_note" field is non-breaking.\nRenaming "total" to "amount" requires /v2 and keeps /v1 for 12 months.',
      q: [
        ['Which change is non-breaking?', ['Adding a new optional response field', 'Renaming an existing field', 'Changing a field from string to number', 'Removing an endpoint'], 'Adding a new optional response field', 'Additive changes do not break existing clients.', 'basic', 'understanding'],
        ['How long must a deprecated major version stay supported?', ['One week', 'One month', 'At least twelve months', 'Forever'], 'At least twelve months', 'The standard requires a 12-month deprecation period.', 'intermediate', 'recall'],
      ],
      f: [
        ['4xx vs 5xx?', '4xx: the client must change the request. 5xx: the server failed; retrying may help.', 'basic'],
        ['What requires a new major version?', 'Breaking changes: removing/renaming fields or changing types.', 'intermediate'],
      ],
    },
    {
      title: 'Pagination and Filtering',
      video_type: 'concept',
      status: 'pending',
      source_chapter: '1. Resource Design',
      source_section: '1.3 Collections',
    },
  ],
};
