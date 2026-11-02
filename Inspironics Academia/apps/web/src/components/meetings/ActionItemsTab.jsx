import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, Pencil, Plus, Quote, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EmptyState from '@/components/EmptyState';
import { ActionStatusSelect, DueLabel, PriorityChip } from '@/components/meetings/MeetingBits';
import { useAuth } from '@/lib/AuthContext';
import { ACTION_LABEL, formatClock, isOpen, useInvalidateMeetings } from '@/lib/meetings';

const NOBODY = '__none__';

function useUsers(enabled) {
  return useQuery({ queryKey: ['users', 'all'], enabled, queryFn: () => api.entities.User.list('full_name', 1000) });
}

/** Admin: create or edit an action item. */
function ActionItemDialog({ meeting, item, open, onOpenChange }) {
  const refresh = useInvalidateMeetings();
  const { data: users = [] } = useUsers(open);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const current = form || {
    task: item?.task || '',
    detail: item?.detail || '',
    owner_user_id: item?.owner_user_id || '',
    owner_name: item?.owner_name || '',
    due_date: item?.due_date || '',
    priority: item?.priority || 'medium',
  };
  const set = (patch) => setForm({ ...current, ...patch });
  const close = (o) => { if (!o) setForm(null); onOpenChange(o); };

  const save = async () => {
    if (!current.task.trim()) return toast.error('Describe the task');
    setSaving(true);
    const data = { ...current, task: current.task.trim(), due_date: current.due_date || '' };
    try {
      if (item) await api.entities.ActionItem.update(item.id, data);
      else {
        await api.entities.ActionItem.create({
          ...data, meeting_id: meeting.id, meeting_title: meeting.title, meeting_date: meeting.meeting_date,
          status: 'open', edited: true, published: meeting.status === 'published',
        });
      }
      toast.success(item ? 'Action item updated' : 'Action item added');
      refresh();
      close(false);
    } catch (e) {
      toast.error(e?.message || 'Could not save the action item');
    } finally {
      setSaving(false);
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{item ? 'Edit action item' : 'Add action item'}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ai-task">Task</Label>
            <Input id="ai-task" value={current.task} onChange={(e) => set({ task: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-detail">Details</Label>
            <Textarea id="ai-detail" rows={2} value={current.detail} onChange={(e) => set({ detail: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ai-owner">Owner account</Label>
              <Select
                value={current.owner_user_id || NOBODY}
                onValueChange={(v) => {
                  const u = users.find((x) => x.id === v);
                  set({ owner_user_id: v === NOBODY ? '' : v, owner_name: u ? (u.full_name || u.email) : current.owner_name });
                }}
              >
                <SelectTrigger id="ai-owner"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOBODY}>No account</SelectItem>
                  {users.filter((u) => !u.disabled).map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-owner-name">Owner name</Label>
              <Input id="ai-owner-name" value={current.owner_name} onChange={(e) => set({ owner_name: e.target.value })} placeholder="As named in the meeting" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-due">Due date</Label>
              <Input id="ai-due" type="date" value={current.due_date} onChange={(e) => set({ due_date: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-priority">Priority</Label>
              <Select value={current.priority} onValueChange={(v) => set({ priority: v })}>
                <SelectTrigger id="ai-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['high', 'medium', 'low'].map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {item?.owner_user_id !== current.owner_user_id && current.owner_user_id && meeting.status === 'published' && (
            <p className="text-xs text-muted-foreground">The new owner is notified.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{item ? 'Save' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ActionItemsTab({ meeting, items, onJump }) {
  const { user, isAdmin } = useAuth();
  const refresh = useInvalidateMeetings();
  const [status, setStatus] = useState('active');
  const [owner, setOwner] = useState('all');
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | item

  const owners = useMemo(() => [...new Set(items.map((a) => a.owner_name).filter(Boolean))].sort(), [items]);
  const visible = items
    .filter((a) => (status === 'all' ? true : status === 'active' ? isOpen(a) : a.status === status))
    .filter((a) => owner === 'all' || a.owner_name === owner)
    .filter((a) => !mine || a.owner_user_id === user?.id)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));

  const setItemStatus = async (item, next) => {
    try {
      await api.entities.ActionItem.update(item.id, { status: next });
      toast.success(`Marked ${ACTION_LABEL[next].toLowerCase()}`);
      refresh();
    } catch (e) {
      toast.error(e?.message || 'Could not update the status');
    }
  };

  const remove = async (item) => {
    try {
      await api.entities.ActionItem.delete(item.id);
      toast.success('Action item deleted');
      refresh();
    } catch (e) {
      toast.error(e?.message || 'Could not delete');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" aria-label="Status filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Open & in progress</SelectItem>
            <SelectItem value="all">All</SelectItem>
            {Object.entries(ACTION_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-44" aria-label="Owner filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every owner</SelectItem>
            {owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <label htmlFor="ai-mine" className="flex items-center gap-2 text-sm">
          <Switch id="ai-mine" checked={mine} onCheckedChange={setMine} /> Only mine
        </label>
        <span className="text-sm text-muted-foreground tabular-nums">{visible.length} of {items.length}</span>
        {isAdmin && <Button size="sm" className="ml-auto" onClick={() => setEditing('new')}><Plus /> Add action item</Button>}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={ListChecks} title="No action items here" description={items.length ? 'Change the filters to see more.' : 'No commitments were found in this meeting.'} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[280px]">Task</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="w-20"><span className="sr-only">Edit</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => {
                const canSet = isAdmin || (a.owner_user_id && a.owner_user_id === user?.id);
                return (
                  <TableRow key={a.id} className={a.owner_user_id === user?.id ? 'bg-primary/[.03]' : undefined}>
                    <TableCell className="align-top">
                      <div className={a.status === 'done' || a.status === 'cancelled' ? 'text-muted-foreground line-through decoration-1' : 'font-medium'}>{a.task}</div>
                      {a.detail && <div className="mt-0.5 text-xs text-muted-foreground">{a.detail}</div>}
                      {a.source_quote && (
                        <button
                          type="button"
                          onClick={() => onJump(a.source_time)}
                          className="mt-1.5 flex max-w-xl items-start gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                          title="Show in the transcript"
                        >
                          <Quote className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-2 italic">{a.source_quote}</span>
                          {a.source_time != null && <span className="shrink-0 tabular-nums text-primary">{formatClock(a.source_time)}</span>}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-sm">
                      {a.owner_name || <span className="text-muted-foreground">Unassigned</span>}
                      {a.owner_user_id === user?.id && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary">YOU</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-sm"><DueLabel item={a} /></TableCell>
                    <TableCell className="align-top"><PriorityChip priority={a.priority} /></TableCell>
                    <TableCell className="align-top">
                      {canSet
                        ? <ActionStatusSelect id={`status-${a.id}`} value={a.status} onChange={(v) => setItemStatus(a, v)} />
                        : <span className="text-sm">{ACTION_LABEL[a.status]}</span>}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap align-top">
                        <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(a)}><Pencil /></Button>
                        <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove(a)}><Trash2 /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {isAdmin && (
        <ActionItemDialog
          key={editing === 'new' ? 'new' : editing?.id || 'none'}
          meeting={meeting}
          item={editing && editing !== 'new' ? editing : null}
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </div>
  );
}
