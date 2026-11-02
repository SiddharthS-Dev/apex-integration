import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Gavel, LayoutGrid, ListChecks, Pencil, Users } from 'lucide-react';
import { teamPeople } from '@academy/shared';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import { formatDay, isOpen } from '@/lib/meetings';
import TeamRosterDialog from './TeamRosterDialog';

// One card per team (Meeting.team: the Dropbox sub-folder a transcript was filed in, or set by an
// admin). Clicking a card shows that team's meetings; "All teams" clears the choice.
//
// People are counted from the team's roster (Team: members and SMEs) when it has one — a transcript
// only says who spoke, which includes guests and shared logins. Without a roster, everyone who spoke
// is counted, spelling variants merged.

export const NO_TEAM = '__none__';
/** The key a meeting is grouped under (its team, or NO_TEAM). */
export const teamKey = (m) => (m.team && m.team.trim()) || NO_TEAM;

// Each team keeps its colour across visits: picked from its name.
const PALETTE = [
  'from-indigo-500 to-violet-500',
  'from-sky-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-fuchsia-500 to-purple-500',
];
const colourOf = (name) => PALETTE[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function summarise(meetings, itemsBy, rosters) {
  const groups = new Map();
  for (const m of meetings) {
    const key = teamKey(m);
    const g = groups.get(key) || { key, name: key === NO_TEAM ? 'No team' : key, meetings: 0, list: [], decisions: 0, open: 0, latest: '' };
    g.meetings += 1;
    g.list.push(m);
    g.decisions += m.decisions?.length || 0;
    g.open += (itemsBy.get(m.id) || []).filter(isOpen).length;
    const day = m.meeting_date || '';
    if (day > g.latest) g.latest = day;
    groups.set(key, g);
  }
  // SMEs on any saved roster are SMEs wherever they join (they advise across teams).
  const smes = rosters.flatMap((t) => (t.members || []).filter((m) => m.role === 'sme').map((m) => m.name));
  for (const g of groups.values()) {
    g.roster = rosters.find((t) => t.name?.trim().toLowerCase() === g.name.toLowerCase()) || null;
    g.smes = smes;
    g.people = teamPeople(g.list, g.roster, { smes });
  }
  // Busiest teams first; meetings without a team last.
  return [...groups.values()].sort((a, b) => (a.key === NO_TEAM) - (b.key === NO_TEAM) || b.meetings - a.meetings || a.name.localeCompare(b.name));
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="min-w-0">
      <div className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums"><Icon className="h-3.5 w-3.5 text-primary" />{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function TeamCard({ team, selected, onSelect, onEdit }) {
  const colour = team.key === NO_TEAM ? 'from-slate-400 to-slate-500' : colourOf(team.name);
  const { people } = team;
  return (
    <div className="relative">
    <button
      type="button"
      onClick={() => onSelect(selected ? null : team.key)}
      aria-pressed={selected}
      className={cn(
        'group relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 text-left transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40',
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', colour)} />
      <div className="flex items-center gap-3">
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm', colour)}>
          {team.key === NO_TEAM ? <Users className="h-5 w-5" /> : initials(team.name)}
        </span>
        <div className="min-w-0 pr-7">
          <h3 className="truncate font-semibold">{team.name}</h3>
          <p className="text-xs text-muted-foreground">
            {team.meetings} meeting{team.meetings === 1 ? '' : 's'}
            {team.latest && <> · <CalendarDays className="mb-0.5 inline h-3 w-3" /> {formatDay(team.latest)}</>}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
        <Stat icon={Users} value={people.people.length} label="team members" />
        <Stat icon={Gavel} value={team.decisions} label="decisions" />
        <Stat icon={ListChecks} value={team.open} label="open actions" />
      </div>
      {people.people.length > 0 && (
        <p className="text-xs text-muted-foreground" title={[...people.members, ...people.smes.map((s) => `${s} (SME)`)].join(', ')}>
          {plural(people.members.length, 'member')} · {plural(people.smes.length, 'SME')}
          {people.guests.length > 0 && <span title={`Guests: ${people.guests.join(', ')}`}> · {plural(people.guests.length, 'guest')}</span>}
        </p>
      )}
    </button>
    {onEdit && team.key !== NO_TEAM && (
      <button
        type="button"
        onClick={() => onEdit(team)}
        aria-label={`Edit the ${team.name} team`}
        title={people.roster ? 'Edit members and SMEs' : 'Members are taken from the meetings — edit to confirm'}
        className="absolute right-3 top-4 grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    )}
    </div>
  );
}

export default function TeamCards({ meetings, itemsBy, selected, onSelect, isAdmin = false }) {
  const { data: rosters = [] } = useQuery({ queryKey: ['teams'], queryFn: () => api.entities.Team.list('name', 200) });
  const [editing, setEditing] = useState(null);
  const teams = summarise(meetings, itemsBy, rosters);
  return (
    <section aria-label="Teams" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><LayoutGrid className="h-4 w-4 text-primary" /> Teams</h2>
        {selected != null && (
          <button type="button" className="text-sm text-primary hover:underline" onClick={() => onSelect(null)}>All teams</button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {teams.map((t) => <TeamCard key={t.key} team={t} selected={selected === t.key} onSelect={onSelect} onEdit={isAdmin ? setEditing : null} />)}
      </div>
      <TeamRosterDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        teamName={editing?.name}
        team={editing?.roster}
        meetings={editing?.list || []}
        smes={editing?.smes || []}
      />
    </section>
  );
}
