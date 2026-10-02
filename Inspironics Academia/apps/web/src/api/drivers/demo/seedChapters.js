// Chapter text for the demo playbooks (what extraction would have produced).

export const SRE_CHAPTERS = [
  {
    number: '1',
    title: 'Service Level Objectives',
    summary: 'Defines user-centric SLIs, SLO targets over rolling windows, error budgets and burn-rate alerting.',
    section_count: 3,
    content: '1.1 User-centric indicators. Every service defines SLIs as good events divided by valid events, measured as close to the user as possible.\n\n1.2 Targets and error budgets. SLOs are set over a rolling 28-day window. The error budget is 100% minus the target. When the budget is exhausted, feature releases pause under the error budget policy.\n\n1.3 SLO-based alerting. Page on fast burn rates confirmed over a long and a short window; open tickets for slow burns.',
  },
  {
    number: '2',
    title: 'Incident Response',
    summary: 'Incident roles (commander, operations, communications), severity levels, mitigation-first response and blameless postmortems.',
    section_count: 3,
    content: '2.1 Roles during an incident. The incident commander coordinates, the operations lead directs changes, the communications lead posts updates every 30 minutes.\n\n2.2 Severity levels. SEV-1 is a full outage of a critical user journey; SEV-2 a significant degradation; SEV-3 a minor issue.\n\n2.3 Learning from incidents. Postmortems are blameless, drafted within five working days, and every action item has an owner and a due date.',
  },
  {
    number: '3',
    title: 'Change Management',
    summary: 'Progressive delivery with canaries and feature flags, pre-agreed rollback criteria and reversible migrations.',
    section_count: 2,
    content: '3.1 Change review. Every production change is peer reviewed and linked to a ticket.\n\n3.2 Canary releases and rollback. Canary 1-5% of traffic, compare SLIs, roll back automatically when the canary error rate exceeds twice the baseline for five minutes. Database changes follow expand-and-contract.',
  },
];

export const API_CHAPTERS = [
  {
    number: '1',
    title: 'Resource Design',
    summary: 'Resource-oriented URLs, HTTP method semantics, naming rules, pagination and filtering of collections.',
    section_count: 3,
    content: '1.1 Naming resources. Plural nouns for collections, ids for items, nesting at most one level.\n\n1.2 Methods. GET reads, POST creates, PATCH updates partially, DELETE removes.\n\n1.3 Collections. Cursor-based pagination with a limit parameter; filtering through query parameters.',
  },
  {
    number: '2',
    title: 'Errors and Versioning',
    summary: 'Standard error body, status code semantics, additive evolution and major-version deprecation policy.',
    section_count: 2,
    content: '2.1 Error format. Correct status codes with a JSON body of code, message and details. Never 200 with an error.\n\n2.2 Versioning. Additive changes are allowed; breaking changes require a new major version and a 12-month deprecation period.',
  },
];
