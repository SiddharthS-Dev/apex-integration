import { CircleHelp, Gavel, Lightbulb, ShieldAlert, Target } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { PriorityChip } from '@/components/meetings/MeetingBits';
import { REQUIREMENT_LABEL } from '@/lib/meetings';

function Section({ icon: Icon, title, children, count }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4 text-primary" /> {title}
        {count != null && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

const Muted = ({ children }) => <p className="text-sm text-muted-foreground">{children}</p>;

export function OverviewTab({ meeting }) {
  const themes = meeting.themes || [];
  const decisions = meeting.decisions || [];
  return (
    <div className="space-y-8">
      {(meeting.purpose || meeting.summary) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {meeting.purpose && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Target className="h-3.5 w-3.5" /> Purpose</div>
              <p className="text-sm leading-relaxed">{meeting.purpose}</p>
            </div>
          )}
          {meeting.summary && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</div>
              <p className="max-w-[75ch] text-sm leading-relaxed">{meeting.summary}</p>
            </div>
          )}
        </div>
      )}

      <Section icon={Lightbulb} title="Key ideas" count={themes.length || null}>
        {themes.length === 0 ? <Muted>No key ideas were identified.</Muted> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {themes.map((t) => (
              <article key={t.title} className="rounded-xl border border-border bg-card p-4">
                <h3 className="font-medium">{t.title}</h3>
                {t.detail && <p className="mt-1 text-sm text-muted-foreground">{t.detail}</p>}
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Gavel} title="Decisions" count={decisions.length || null}>
        {decisions.length === 0 ? <Muted>No decisions were recorded.</Muted> : (
          <ol className="space-y-2">
            {decisions.map((d, i) => (
              <li key={`${d.decision}-${i}`} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">{i + 1}</span>
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{d.decision}</p>
                  {d.rationale && <p className="text-sm text-muted-foreground">{d.rationale}</p>}
                  {d.owner && <p className="text-xs text-muted-foreground">Decided by {d.owner}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

export function RequirementsTab({ meeting }) {
  const reqs = meeting.requirements || [];
  if (!reqs.length) return <EmptyState icon={Target} title="No requirements" description="Nothing in this meeting was stated as a requirement." />;
  const groups = Object.keys(REQUIREMENT_LABEL).map((type) => [type, reqs.filter((r) => (r.type || 'other') === type)]).filter(([, list]) => list.length);
  return (
    <div className="space-y-6">
      {groups.map(([type, list]) => (
        <Section key={type} icon={Target} title={REQUIREMENT_LABEL[type]} count={list.length}>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {list.map((r, i) => (
              <li key={`${r.text}-${i}`} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-sm">{r.text}</p>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {r.raised_by && <span>Raised by {r.raised_by}</span>}
                  <PriorityChip priority={r.priority} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

export function QuestionsRisksTab({ meeting }) {
  const questions = meeting.open_questions || [];
  const risks = [...(meeting.risks || [])].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.impact) - ['high', 'medium', 'low'].indexOf(b.impact));
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Section icon={CircleHelp} title="Open questions" count={questions.length || null}>
        {questions.length === 0 ? <Muted>No open questions.</Muted> : (
          <ul className="space-y-2">
            {questions.map((q, i) => (
              <li key={`${q.question}-${i}`} className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm">{q.question}</p>
                {q.owner && <p className="mt-1 text-xs text-muted-foreground">Follow-up: {q.owner}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section icon={ShieldAlert} title="Risks" count={risks.length || null}>
        {risks.length === 0 ? <Muted>No risks were raised.</Muted> : (
          <ul className="space-y-2">
            {risks.map((r, i) => (
              <li key={`${r.risk}-${i}`} className="space-y-1.5 rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{r.risk}</p>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">Impact <PriorityChip priority={r.impact} /></span>
                </div>
                {r.mitigation && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Mitigation:</span> {r.mitigation}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
