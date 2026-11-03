import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import Field from '@/components/auth/Field';
import SelectField from '@/components/admin/editor/SelectField';
import { LEARNERS_KEY } from '@/components/admin/learners/learnerData';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AUDIENCES } from '@/lib/categories';

export default function InviteForm({ onInvited, onCancel }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ email: '', full_name: '', role: 'user', audience: 'employee' });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const invite = useMutation({
    mutationFn: () => api.auth.inviteUser(form.email.trim(), form.role, form.full_name.trim(), form.audience),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: LEARNERS_KEY });
      onInvited({ email: res?.user?.email || form.email.trim(), password: res?.temporary_password, emailSent: !!res?.email_sent });
    },
    onError: (err) => toast.error(err?.message || 'Could not invite user'),
  });
  const submit = (e) => {
    e.preventDefault();
    if (form.email.trim()) invite.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="invite-email" label="Email" type="email" required value={form.email} onChange={set('email')} placeholder="name@company.com" />
      <Field id="invite-name" label="Full name" value={form.full_name} onChange={set('full_name')} placeholder="Optional" />
      <SelectField id="invite-role" label="Role" value={form.role} onChange={(role) => setForm((f) => ({ ...f, role }))} options={['user', 'admin']} />
      <div className="space-y-1.5">
        <Label htmlFor="invite-audience">Audience</Label>
        <Select value={form.audience} onValueChange={(audience) => setForm((f) => ({ ...f, audience }))}>
          <SelectTrigger id="invite-audience"><SelectValue /></SelectTrigger>
          <SelectContent>
            {AUDIENCES.map((a) => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Decides which playbook categories and courses they can see.</p>
      </div>
      <DialogFooter>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={invite.isPending || !form.email.trim()}>
          {invite.isPending && <Loader2 className="animate-spin" />} Create account
        </Button>
      </DialogFooter>
    </form>
  );
}
