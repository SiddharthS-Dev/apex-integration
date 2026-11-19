import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, FileText, HelpCircle, Inbox, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { APEX_PLATFORMS, ONBOARDING_INTERESTS, ONBOARDING_ROLES, onboardingCategory, onboardingRole } from '@academy/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import ActionDialog from '@/components/core/ActionDialog';
import { CoreHint, CoreQueryError } from '@/components/core/CoreNotice';
import { SelectField, TextField } from '@/components/core/Field';
import { formatWhen, roleLabel } from '@/lib/core';

// Access requests (Use Case 007): the review queue and one request's detail, with deliberate approve,
// request-information and reject actions. Everything shown here is applicant-supplied except the
// verified email; nothing is preselected for approval, and the API checks every choice again.

const STATUS_OPTIONS = [
  { value: 'reviewable', label: 'Waiting for review' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'INFO_REQUESTED', label: 'Information requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'all', label: 'All decided and pending' },
];
const ROLE_OPTIONS = [{ value: 'any', label: 'Any role' }, ...ONBOARDING_ROLES.map((r) => ({ value: r.code, label: r.label }))];
const ROLE_NOTES = { intern: 'only once the internship offer is verified', alumni: 'only once the former association is verified' };
const STATUS_TEXT = { PENDING_APPROVAL: 'Pending approval', INFO_REQUESTED: 'Information requested', APPROVED: 'Approved', REJECTED: 'Rejected', EXPIRED: 'Expired', SUPERSEDED: 'Superseded' };
const categoryLabel = (code) => onboardingCategory(code)?.label || code;
const roleName = (row) => onboardingRole(row.onboarding_role)?.label || categoryLabel(row.primary_category_code);
const interestLabel = (code) => ONBOARDING_INTERESTS.find((i) => i.code === code)?.label || code;
const PREF_LABELS = { country_code: 'Country', timezone: 'Time zone', locale: 'Format', date_format: 'Dates', unit_system: 'Units' };
const platformLabel = (code) => APEX_PLATFORMS.find((p) => p.code === code)?.label || code;
const human = (v) => (Array.isArray(v) ? v.map(human).join(', ') : /^\d+_\d+$/.test(String(v)) ? String(v).replace('_', '–') : String(v).replace(/_/g, ' '));

function ApproveDialog({ detail, onOpenChange, onDone }) {
  const [approvedRole, setApprovedRole] = useState(detail.requested.onboarding_role);
  const [roles, setRoles] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const requestedPlatforms = detail.requested.platforms || [];
  // Platforms shown on the person's APEX home: what they asked for, which the approver may change.
  const [platforms, setPlatforms] = useState(requestedPlatforms.length ? requestedPlatforms : APEX_PLATFORMS.map((p) => p.code));
  const toggle = (role) => setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]));
  const togglePlatform = (code) => setPlatforms((p) => (p.includes(code) ? p.filter((x) => x !== code) : [...p, code]));
  const submit = async () => {
    const r = await api.core.approveRegistration(detail.id, {
      onboarding_role: approvedRole, roles: roles.map((role) => ({ role, scope_type: 'platform' })), confirm: true, note: note.trim() || null,
      platforms: APEX_PLATFORMS.map((p) => p.code).filter((c) => platforms.includes(c)),
    });
    toast.success(r.password_chosen
      ? 'Approved. The person can sign in now with the password they chose; an approval email was sent.'
      : r.invitation_sent ? 'Approved. The invitation email with the set-password link was sent.' : 'Approved. The account was created; the invitation email is queued.');
    onDone?.();
  };
  return (
    <ActionDialog
      open onOpenChange={onOpenChange} title="Approve this request?" submitLabel="Approve and create account" onSubmit={submit}
      description="Creates an account for the verified email address with only the roles you tick. No organisation or resource access is granted here."
      validate={() => (!platforms.length ? 'Choose at least one APEX platform.' : !confirmed ? 'Confirm that you checked the role and every access choice.' : '')}
    >
      <SelectField label="Approved role" value={approvedRole} onChange={(v) => { setApprovedRole(v); setRoles([]); }} options={ONBOARDING_ROLES.map((r) => ({ value: r.code, label: r.label }))}
        hint={approvedRole !== detail.requested.onboarding_role ? `Changes the applicant's choice (${detail.requested.role_label}); the change is audited.` : 'As the applicant chose.'} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Roles to grant (platform-wide)</legend>
        <p className="text-xs text-muted-foreground">
          Requested: none (applicants cannot ask for roles). Suggested least-privileged: {detail.default_roles.map(roleLabel).join(', ') || 'none'}.
          Administrator roles cannot be granted here.
        </p>
        {(onboardingRole(approvedRole)?.grants || []).map((role) => (
          <label key={role} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={roles.includes(role)} onChange={() => toggle(role)} />
            {roleLabel(role)}
            {ROLE_NOTES[role] && <span className="text-xs text-muted-foreground">— {ROLE_NOTES[role]}</span>}
          </label>
        ))}
        {!roles.length && <p className="text-xs text-amber-600">With no role, the account can sign in but holds no access.</p>}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">APEX platforms shown on their home</legend>
        <p className="text-xs text-muted-foreground">
          Requested: {requestedPlatforms.map(platformLabel).join(', ') || 'none'}. Innovation Showcase and SlidesVault also need an account there,
          created and linked in People &amp; access; until then that card says sign-in is required.
        </p>
        {APEX_PLATFORMS.map((p) => (
          <label key={p.code} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={platforms.includes(p.code)} onChange={() => togglePlatform(p.code)} />
            {p.label}
            {requestedPlatforms.includes(p.code) && <span className="text-xs text-muted-foreground">— requested</span>}
          </label>
        ))}
      </fieldset>
      <TextField label="Internal note" value={note} onChange={setNote} hint="Never shown to the applicant." />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I have checked the role, each access choice, and the claims I relied on.
      </label>
    </ActionDialog>
  );
}

function RejectDialog({ detail, onOpenChange, onDone }) {
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const submit = async () => {
    await api.core.rejectRegistration(detail.id, { reason: reason.trim(), message: message.trim() || null });
    toast.success('Request rejected');
    onDone?.();
  };
  return (
    <ActionDialog
      open onOpenChange={onOpenChange} destructive title="Reject this request?" submitLabel="Reject request" onSubmit={submit}
      description="No account is created. The applicant is told by email; the reason below stays internal."
      validate={() => (reason.trim().length < 5 ? 'Give a meaningful reason (at least 5 characters).' : '')}
    >
      <TextField label="Reason (internal)" required value={reason} onChange={setReason} />
      <TextField label="Message to the applicant" value={message} onChange={setMessage} hint="Sent in the email. Leave empty for the standard wording." maxLength={2000} />
    </ActionDialog>
  );
}

function InfoDialog({ detail, onOpenChange, onDone }) {
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const submit = async () => {
    await api.core.requestRegistrationInfo(detail.id, { question: question.trim(), note: note.trim() || null });
    toast.success('Question sent. The applicant answers through a private link.');
    onDone?.();
  };
  return (
    <ActionDialog
      open onOpenChange={onOpenChange} title="Ask the applicant a question" submitLabel="Send question" onSubmit={submit}
      description="The question is emailed with a private link that expires. The internal note is not sent."
      validate={() => (!question.trim() ? 'Write the question.' : '')}
    >
      <TextField label="Question for the applicant" required value={question} onChange={setQuestion} maxLength={2000} />
      <TextField label="Internal note" value={note} onChange={setNote} />
    </ActionDialog>
  );
}

function Row({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

const fileSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** One attached document (the intern mark sheet) with a download button; each opening is audited by the API. */
function DocumentRow({ requestId, doc }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const blob = await api.core.registrationDocument(requestId, doc.kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err.message || 'Could not download the file.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row label={doc.label || doc.kind}>
      <span className="inline-flex flex-wrap items-center gap-2">
        <FileText className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <span className="break-all">{doc.file_name}</span>
        <span className="text-muted-foreground">· {fileSize(doc.size_bytes)} · {formatWhen(doc.uploaded_at)}</span>
        <Button type="button" size="sm" variant="outline" onClick={download} disabled={busy} aria-label={`Download ${doc.file_name}`}>
          <Download className="w-4 h-4 mr-1" aria-hidden="true" />{busy ? 'Downloading…' : 'Download'}
        </Button>
      </span>
    </Row>
  );
}

function Detail({ id, onDecided }) {
  const [dialog, setDialog] = useState(null);
  const q = useQuery({ queryKey: ['core', 'registration', id], queryFn: () => api.core.registration(id) });
  if (q.isLoading) return <LoadingState label="Loading request…" />;
  if (q.error) return <CoreQueryError error={q.error} title="Could not load the request" />;
  const d = q.data;
  const reviewable = ['PENDING_APPROVAL', 'INFO_REQUESTED'].includes(d.status);
  const advice = d.advice || {};
  const done = () => { setDialog(null); onDecided(); };
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{d.full_name}</h3>
          <p className="text-sm text-muted-foreground">{roleName(d)} · submitted {formatWhen(d.submitted_at)}</p>
        </div>
        <Badge variant={d.status === 'APPROVED' ? 'default' : d.status === 'REJECTED' ? 'outline' : 'secondary'}>{STATUS_TEXT[d.status] || d.status}</Badge>
      </div>

      <section aria-labelledby={`verif-${id}`}>
        <h4 id={`verif-${id}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Verification</h4>
        <dl>
          <Row label="Email (verified)"><span className="inline-flex items-center gap-1"><Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />{d.verification.email}</span></Row>
          <Row label="Organisation (claimed)">{d.requested.claimed_organization ? <span>{d.requested.claimed_organization} <Badge variant="outline" className="ml-1">not verified</Badge></span> : '—'}</Row>
          <Row label="Adult attestation">{d.consent.adult_confirmed_at ? `Confirmed ${formatWhen(d.consent.adult_confirmed_at)}` : '—'}</Row>
          <Row label="Notice accepted">{`${d.consent.version} · ${formatWhen(d.consent.accepted_at)}`}</Row>
        </dl>
      </section>

      <section aria-labelledby={`req-${id}`}>
        <h4 id={`req-${id}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requested (self-reported)</h4>
        <dl>
          <Row label="Role (self-selected)">{d.requested.role_label || d.requested.category_label}</Row>
          {d.profile_fields.map((f) => {
            const v = d.profile[f.key];
            const purposes = onboardingCategory(d.primary_category_code)?.purposes || [];
            if (f.type === 'enum' && v !== undefined) return <Row key={f.key} label={f.label}>{human(v)}</Row>;
            const text = v === undefined ? null : f.key === 'purposes' ? v.map((c) => purposes.find((p) => p.code === c)?.title || c).join(', ') : f.type === 'enum' ? human(v) : String(v);
            return <Row key={f.key} label={f.label}>{text}</Row>;
          })}
          <Row label="Interests">{d.requested.interest_codes.map(interestLabel).join(', ') || null}</Row>
          <Row label="Something else">{d.requested.interest_other}</Row>
          <Row label="APEX platforms">{(d.requested.platforms || []).map(platformLabel).join(', ') || '—'}</Row>
          <Row label="Preferences">{Object.entries(d.preferences).filter(([k]) => k !== 'platforms').map(([k, v]) => `${PREF_LABELS[k] || human(k)}: ${v}`).join(' · ') || '—'}</Row>
        </dl>
        <p className="text-xs text-muted-foreground mt-1">Links are shown as text and were never opened automatically.</p>
      </section>

      {(d.documents || []).length > 0 && (
        <section aria-labelledby={`docs-${id}`}>
          <h4 id={`docs-${id}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Documents</h4>
          <dl>{d.documents.map((doc) => <DocumentRow key={doc.kind} requestId={d.id} doc={doc} />)}</dl>
          <p className="text-xs text-muted-foreground mt-1">Uploaded by the applicant; check it matches the stated college and degree. Downloads are recorded in the request history.</p>
        </section>
      )}

      {d.verification_note && (
        <p className="text-sm rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3"><strong>Verify before approving: </strong>{d.verification_note}</p>
      )}
      <section aria-labelledby={`adv-${id}`} className="rounded-xl border border-dashed border-border p-4">
        <h4 id={`adv-${id}`} className="text-sm font-medium flex items-center gap-2">
          Review advice <Badge variant="outline">{advice.source === 'ai' ? `AI-assisted${advice.model ? ` · ${advice.model}` : ''}` : 'Rules only'}</Badge>
        </h4>
        <p className="text-xs text-muted-foreground mb-2">Advisory only. It never approves, and it cannot propose administrator roles, organisations or resources.</p>
        <dl>
          <Row label="Summary">{advice.summary}</Row>
          <Row label="Suggested role">{advice.suggested_role_code ? roleLabel(advice.suggested_role_code) : 'None'}</Row>
          <Row label="Organisation">None proposed (unverified claims are never assigned)</Row>
        </dl>
        {!!advice.observations?.length && (
          <ul className="mt-2 space-y-1 text-sm list-disc pl-5">
            {advice.observations.map((o, i) => <li key={i}>{o.text}{o.code?.startsWith('AI_') && <span className="text-xs text-muted-foreground"> (assistant)</span>}</li>)}
          </ul>
        )}
      </section>

      {(d.clarification.question || d.clarification.answer) && (
        <section aria-labelledby={`clar-${id}`}>
          <h4 id={`clar-${id}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clarification</h4>
          <dl>
            <Row label={`Asked ${formatWhen(d.clarification.asked_at)}`}>{d.clarification.question}</Row>
            <Row label={d.clarification.answered_at ? `Answered ${formatWhen(d.clarification.answered_at)}` : 'Answer'}>{d.clarification.answer || 'Not answered yet'}</Row>
          </dl>
        </section>
      )}

      {d.internal_note && <p className="text-sm"><span className="text-muted-foreground">Internal note: </span>{d.internal_note}</p>}
      {d.decision.decided_at && (
        <p className="text-sm text-muted-foreground">
          Decided {formatWhen(d.decision.decided_at)}
          {d.decision.approved_roles && ` · roles: ${d.decision.approved_roles.map((r) => roleLabel(r.role)).join(', ') || 'none'}`}
          {d.decision.approved_category_code && d.decision.approved_category_code !== d.primary_category_code && ` · approved as ${categoryLabel(d.decision.approved_category_code)}`}
          {d.decision.reason && ` · reason: ${d.decision.reason}`}
        </p>
      )}

      {reviewable && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setDialog('approve')}><Check /> Approve…</Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('info')}><HelpCircle /> Ask a question…</Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('reject')}><X /> Reject…</Button>
        </div>
      )}
      {dialog === 'approve' && <ApproveDialog detail={d} onOpenChange={(o) => !o && setDialog(null)} onDone={done} />}
      {dialog === 'reject' && <RejectDialog detail={d} onOpenChange={(o) => !o && setDialog(null)} onDone={done} />}
      {dialog === 'info' && <InfoDialog detail={d} onOpenChange={(o) => !o && setDialog(null)} onDone={done} />}
    </div>
  );
}

export default function RegistrationsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('reviewable');
  const [role, setRole] = useState('any');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const query = { status, ...(role !== 'any' ? { role } : {}), ...(search.trim() ? { q: search.trim() } : {}) };
  const list = useQuery({ queryKey: ['core', 'registrations', query], queryFn: () => api.core.registrations(query) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['core', 'registrations'] });
    qc.invalidateQueries({ queryKey: ['core', 'registration'] });
    qc.invalidateQueries({ queryKey: ['core', 'audit'] });
  };

  return (
    <div className="space-y-4">
      <CoreHint title="How access requests work">
        People ask for access with the Enterprise Onboarding Assistant. Their email address is verified; everything else they tell us is not. Categories describe people, they grant nothing.
        Approving creates the account with only the roles you tick; administrator roles, organisations and resources are never granted here.
      </CoreHint>
      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <SelectField label="Show" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <SelectField label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
        <div className="space-y-1.5">
          <Label htmlFor="reg-search">Search name, email or organisation</Label>
          <Input id="reg-search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} autoComplete="off" />
        </div>
      </div>
      {list.isLoading && <LoadingState label="Loading requests…" />}
      {list.error && <CoreQueryError error={list.error} title="Could not load access requests" />}
      {list.data && (list.data.length ? (
        <div className="rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Applicant</TableHead><TableHead>Role</TableHead><TableHead>Organisation (claimed)</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead><TableHead className="text-right">Review</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((r) => (
                <TableRow key={r.id} aria-selected={selected === r.id}>
                  <TableCell><span className="font-medium">{r.full_name}</span><span className="block text-xs text-muted-foreground">{r.email}</span></TableCell>
                  <TableCell>{roleName(r)}</TableCell>
                  <TableCell>{r.claimed_organization || '—'}</TableCell>
                  <TableCell><Badge variant="secondary">{STATUS_TEXT[r.status] || r.status}</Badge>{r.advice_source === 'ai' && <span className="block text-xs text-muted-foreground mt-1">AI-assisted advice</span>}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{formatWhen(r.submitted_at)}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant={selected === r.id ? 'default' : 'outline'} onClick={() => setSelected(selected === r.id ? null : r.id)} aria-expanded={selected === r.id}>{selected === r.id ? 'Close' : 'Open'}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState icon={Inbox} title={status === 'reviewable' ? 'Nothing waiting for review' : 'No requests'} description="Submitted access requests appear here after the applicant confirms their email address." />)}
      {selected && <Detail key={selected} id={selected} onDecided={refresh} />}
      {!list.isLoading && !list.error && <p className="text-xs text-muted-foreground flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" /> Platform administrators only. Every decision is recorded in the audit log.</p>}
    </div>
  );
}
