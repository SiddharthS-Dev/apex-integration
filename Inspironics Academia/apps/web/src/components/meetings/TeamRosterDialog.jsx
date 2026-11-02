import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { rosterMatch, suggestRoster } from '@academy/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// The roster of a team: its members and subject-matter experts, by the names they have in Teams.
// The team card counts these people; anyone else who spoke in the team's meetings is a guest.
// Aliases catch other spellings a transcript uses ("Sivasubramanian Narayanan" for "Siva Subramanian N").
// A team without a saved roster opens with the one built from its meetings' participants (see
// suggestRoster); "Fill from participants" adds anyone from the meetings who is not listed yet.

const blank = () => ({ name: '', role: 'member', aliases: '' });
const fromSuggestion = (e) => ({ name: e.name, role: e.role, aliases: e.aliases.join(', ') });

export default function TeamRosterDialog({ open, onOpenChange, teamName, team, meetings = [], smes = [] }) {
  const speakers = [...new Set(meetings.flatMap((m) => m.participants || []))];
  const suggested = suggestRoster(meetings, { smes });
  // How many of the team's meetings each listed person spoke in.
  const attendance = (row) => {
    const person = { name: row.name, aliases: row.aliases.split(',').map((a) => a.trim()).filter(Boolean) };
    return row.name.trim() ? meetings.filter((m) => (m.participants || []).some((p) => rosterMatch(p, [person]))).length : null;
  };
  const queryClient = useQueryClient();
  const [rows, setRows] = useState([blank()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const members = team?.members?.length
      ? team.members.map((m) => ({ name: m.name || '', role: m.role === 'sme' ? 'sme' : 'member', aliases: (m.aliases || []).join(', ') }))
      : suggested.length ? suggested.map(fromSuggestion) : [blank()];
    setRows(members);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, team]);

  const fillFromParticipants = () => {
    const listed = rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name, aliases: r.aliases.split(',').map((a) => a.trim()).filter(Boolean) }));
    const missing = suggested.filter((e) => !rosterMatch(e.name, listed));
    if (!missing.length) {
      toast.info('Everyone who regularly joins these meetings is already listed');
      return;
    }
    setRows((r) => [...r.filter((row) => row.name.trim()), ...missing.map(fromSuggestion)]);
    toast.success(`Added ${missing.length} from the meetings`);
  };

  const set = (i, patch) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const save = async () => {
    const members = rows
      .map((r) => ({ name: r.name.trim(), role: r.role, aliases: r.aliases.split(',').map((a) => a.trim()).filter(Boolean) }))
      .filter((r) => r.name);
    setSaving(true);
    try {
      if (team?.id) await api.entities.Team.update(team.id, { members });
      else await api.entities.Team.create({ name: teamName, members });
      toast.success(`${teamName} team saved`);
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err?.message || 'Could not save the team');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{teamName} team</DialogTitle>
          <DialogDescription>
            Members and SMEs, by the names they have in Teams{team?.members?.length ? '' : " — filled in from who joined this team's meetings; check and save"}.
            The team card counts these people; anyone else in the meetings is shown as a guest.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          <div className="grid grid-cols-[minmax(0,1.2fr)_110px_minmax(0,1fr)_70px_36px] gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span>Name</span><span>Role</span><span>Other spellings</span><span>Meetings</span><span />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1.2fr)_110px_minmax(0,1fr)_70px_36px] items-center gap-2">
              <Input aria-label="Name" list="team-speakers" value={row.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. Vishnu RD" />
              <Select value={row.role} onValueChange={(role) => set(i, { role })}>
                <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="sme">SME</SelectItem>
                </SelectContent>
              </Select>
              <Input aria-label="Other spellings" value={row.aliases} onChange={(e) => set(i, { aliases: e.target.value })} placeholder="comma-separated" />
              <span className="text-sm tabular-nums text-muted-foreground" title="Meetings of this team they spoke in">
                {attendance(row) == null ? '—' : `${attendance(row)}/${meetings.length}`}
              </span>
              <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [blank()]))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {/* Names that already appear in this team's transcripts, offered as suggestions. */}
          <datalist id="team-speakers">{speakers.map((s) => <option key={s} value={s} />)}</datalist>
        </div>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRows((r) => [...r, blank()])}><Plus /> Add person</Button>
            <Button variant="outline" size="sm" onClick={fillFromParticipants}><Wand2 /> Fill from participants</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>Save team</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
