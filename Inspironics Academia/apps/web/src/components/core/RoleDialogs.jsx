import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import ActionDialog from '@/components/core/ActionDialog';
import { SelectField, TextField } from '@/components/core/Field';
import { APPS, ROLES, ROLE_CATALOGUE, SCOPE_LABELS, roleLabel, scopeText } from '@/lib/core';

const needReason = (reason) => (reason.trim() ? '' : 'Give a reason. It is kept in the audit log.');

/**
 * Grant a role. Role and scope choices follow the catalogue; organisation scope lists only the
 * organisations the person is an active member of (the API requires it).
 */
export function GrantRoleDialog({ open, onOpenChange, detail, isSelf, onDone }) {
  const [role, setRole] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [reason, setReason] = useState('');
  const memberships = detail?.memberships || [];

  const reset = () => { setRole(''); setScopeType(''); setScopeId(''); setReason(''); };
  const change = (next) => { if (!next) reset(); onOpenChange(next); };

  const allowedScopes = role ? ROLE_CATALOGUE[role].scopes : [];
  const pickRole = (r) => {
    setRole(r);
    const scopes = ROLE_CATALOGUE[r].scopes;
    setScopeType(scopes.length === 1 ? scopes[0] : '');
    setScopeId('');
  };

  const scopeOptions = scopeType === 'organization'
    ? memberships.map((m) => ({ value: m.organization_id, label: m.organization_name || m.organization_id }))
    : scopeType === 'app' ? Object.entries(APPS).map(([value, label]) => ({ value, label })) : [];

  const validate = () => {
    if (!role) return 'Choose a role.';
    if (!scopeType) return 'Choose a scope.';
    if (scopeType !== 'platform' && !scopeId) return scopeType === 'organization' ? 'Choose an organisation.' : 'Choose an app.';
    return needReason(reason);
  };

  const submit = async () => {
    await api.core.grantRole({ user_id: detail.user.id, role, scope_type: scopeType, scope_id: scopeType === 'platform' ? '' : scopeId, reason: reason.trim() });
    toast.success(`${roleLabel(role)} granted`);
    reset();
    onDone?.();
  };

  return (
    <ActionDialog
      open={open} onOpenChange={change} title="Grant a role"
      description={`To ${detail?.user?.full_name || detail?.user?.email}. The role starts now and stays until it is revoked.`}
      submitLabel="Grant role" onSubmit={submit} validate={validate}
    >
      <SelectField
        label="Role" value={role} onChange={pickRole}
        options={ROLES.map((r) => ({
          value: r,
          label: r === 'platform_admin' && isSelf ? `${roleLabel(r)} (not for yourself)` : roleLabel(r),
          disabled: r === 'platform_admin' && isSelf,
        }))}
        hint={role ? ROLE_CATALOGUE[role].hint : isSelf ? 'You cannot grant yourself platform admin; another administrator has to.' : undefined}
      />
      {role && (
        <SelectField
          label="Scope" value={scopeType} onChange={(v) => { setScopeType(v); setScopeId(''); }}
          options={allowedScopes.map((s) => ({ value: s, label: SCOPE_LABELS[s] }))}
          disabled={allowedScopes.length === 1}
        />
      )}
      {scopeType === 'organization' && (
        scopeOptions.length
          ? <SelectField label="Organisation" value={scopeId} onChange={setScopeId} options={scopeOptions} hint="Only organisations this person is a member of." />
          : <p className="text-sm text-muted-foreground">This person is not a member of any organisation. Add a membership first (Organisations tab).</p>
      )}
      {scopeType === 'app' && <SelectField label="App" value={scopeId} onChange={setScopeId} options={scopeOptions} />}
      <TextField label="Reason" required value={reason} onChange={setReason} placeholder="Why this access is needed" />
    </ActionDialog>
  );
}

/** Revoke an active assignment (it is closed, not deleted: history stays). */
export function RevokeRoleDialog({ open, onOpenChange, assignment, orgNames, onDone }) {
  const [reason, setReason] = useState('');
  const change = (next) => { if (!next) setReason(''); onOpenChange(next); };
  const submit = async () => {
    await api.core.revokeRole(assignment.id, { reason: reason.trim() });
    toast.success(`${roleLabel(assignment.role)} revoked`);
    setReason('');
    onDone?.();
  };
  return (
    <ActionDialog
      open={open} onOpenChange={change} destructive submitLabel="Revoke role" title="Revoke this role?"
      description={assignment ? `${roleLabel(assignment.role)} · ${scopeText(assignment.scope_type, assignment.scope_id, orgNames)}. It ends now; the record stays in the history.` : ''}
      onSubmit={submit} validate={() => needReason(reason)}
    >
      <TextField label="Reason" required value={reason} onChange={setReason} />
    </ActionDialog>
  );
}

/** Change one role into another in the same scope, in a single step (old one ends, new one starts). */
export function TransitionRoleDialog({ open, onOpenChange, assignment, orgNames, isSelf, onDone }) {
  const [toRole, setToRole] = useState('');
  const [reason, setReason] = useState('');
  const change = (next) => { if (!next) { setToRole(''); setReason(''); } onOpenChange(next); };
  const options = assignment
    ? ROLES.filter((r) => r !== assignment.role && ROLE_CATALOGUE[r].scopes.includes(assignment.scope_type))
      .map((r) => ({ value: r, label: roleLabel(r), disabled: r === 'platform_admin' && isSelf }))
    : [];
  const submit = async () => {
    await api.core.transitionRole(assignment.id, { to_role: toRole, reason: reason.trim() });
    toast.success(`Changed to ${roleLabel(toRole)}`);
    setToRole(''); setReason('');
    onDone?.();
  };
  return (
    <ActionDialog
      open={open} onOpenChange={change} submitLabel="Change role" title="Change role"
      description={assignment ? `From ${roleLabel(assignment.role)} (${scopeText(assignment.scope_type, assignment.scope_id, orgNames)}). The current role ends and the new one starts at the same moment, in the same scope.` : ''}
      onSubmit={submit}
      validate={() => (!toRole ? 'Choose the new role.' : needReason(reason))}
    >
      {options.length
        ? <SelectField label="New role" value={toRole} onChange={setToRole} options={options} />
        : <p className="text-sm text-muted-foreground">No other role can be held in this scope.</p>}
      <TextField label="Reason" required value={reason} onChange={setReason} />
    </ActionDialog>
  );
}
