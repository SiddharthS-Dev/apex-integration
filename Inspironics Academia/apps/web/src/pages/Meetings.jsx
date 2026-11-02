import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CalendarDays, CheckSquare, Clock, Eye, EyeOff, Gavel, ListChecks, Loader2, MoreHorizontal, Presentation, RefreshCw, Search, Trash2, Users,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AvatarStack, MeetingStatus } from '@/components/meetings/MeetingBits';
import UploadTranscriptDialog from '@/components/meetings/UploadTranscriptDialog';
import TeamCards, { NO_TEAM, teamKey } from '@/components/meetings/TeamCards';
import useMeetingActions from '@/components/meetings/useMeetingActions';
import { useAuth } from '@/lib/AuthContext';
import { STATUS_LABEL, formatDay, formatMinutes, isOpen, useAllActionItems, useMeetings } from '@/lib/meetings';

function AdminMenu({ meeting, actions, onDelete }) {
  const working = actions.busy?.endsWith(meeting.id);
  const processed = ['needs_review', 'published'].includes(meeting.status);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Actions for ${meeting.title}`} disabled={working}>
          {working ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => actions.process(meeting)}>
          <RefreshCw /> {meeting.status === 'uploaded' || meeting.status === 'failed' ? 'Process transcript' : 'Reprocess'}
        </DropdownMenuItem>
        {processed && (meeting.status === 'published'
          ? <DropdownMenuItem onClick={() => actions.publish(meeting, false)}><EyeOff /> Unpublish</DropdownMenuItem>
          : <DropdownMenuItem onClick={() => actions.publish(meeting, true)}><Eye /> Publish</DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => onDelete(meeting)}><Trash2 /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MeetingRow({ meeting, items, isAdmin, actions, onDelete }) {
  const open = items.filter(isOpen).length;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 sm:flex-row sm:items-center">
      <Link to={`/meetings/${meeting.id}`} className="min-w-0 flex-1 space-y-1.5 focus-visible:outline-none">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-semibold">{meeting.title}</h3>
          {isAdmin && <MeetingStatus status={meeting.status} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {meeting.meeting_date && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatDay(meeting.meeting_date)}</span>}
          {meeting.duration_minutes > 0 && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatMinutes(meeting.duration_minutes)}</span>}
          {meeting.participants?.length > 0 && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{meeting.participants.length} people</span>}
          {meeting.status === 'failed' && meeting.error && <span className="text-rose-600 dark:text-rose-400">{meeting.error}</span>}
        </div>
        {meeting.summary && <p className="line-clamp-2 text-sm text-muted-foreground">{meeting.summary}</p>}
      </Link>
      <div className="flex shrink-0 items-center gap-4 sm:gap-5">
        {meeting.participants?.length > 0 && <AvatarStack names={meeting.participants} max={4} />}
        <div className="text-center" title="Open action items / all action items">
          <div className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums"><ListChecks className="h-4 w-4 text-primary" />{open}/{items.length}</div>
          <div className="text-[11px] text-muted-foreground">actions</div>
        </div>
        <div className="text-center" title="Decisions">
          <div className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums"><Gavel className="h-4 w-4 text-primary" />{meeting.decisions?.length || 0}</div>
          <div className="text-[11px] text-muted-foreground">decisions</div>
        </div>
        {isAdmin && <AdminMenu meeting={meeting} actions={actions} onDelete={onDelete} />}
      </div>
    </li>
  );
}

export default function Meetings() {
  const { isAdmin } = useAuth();
  const { data: meetings = [], isLoading } = useMeetings();
  const { data: allItems = [] } = useAllActionItems();
  const actions = useMeetingActions();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [doomed, setDoomed] = useState(null);
  // The team whose meetings are shown (from its card); kept in the URL so a team view can be shared.
  const [params, setParams] = useSearchParams();
  const team = params.get('team');
  const chooseTeam = (key) => setParams(key == null ? {} : { team: key }, { replace: true });

  const itemsBy = useMemo(() => {
    const map = new Map();
    for (const a of allItems) map.set(a.meeting_id, [...(map.get(a.meeting_id) || []), a]);
    return map;
  }, [allItems]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return meetings
      .filter((m) => team == null || teamKey(m) === team)
      .filter((m) => status === 'all' || m.status === status)
      .filter((m) => !term || m.title.toLowerCase().includes(term) || (m.participants || []).some((p) => p.toLowerCase().includes(term)))
      .sort((a, b) => {
        const da = a.meeting_date || a.created_date || '';
        const dbb = b.meeting_date || b.created_date || '';
        return sort === 'newest' ? dbb.localeCompare(da) : da.localeCompare(dbb);
      });
  }, [meetings, q, status, sort, team]);

  const reviewCount = meetings.filter((m) => m.status === 'needs_review' || m.status === 'uploaded').length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        icon={Presentation}
        title="Meetings"
        description="Notes from recorded Teams meetings: what was decided, what's required, and who does what by when."
        actions={(
          <>
            <Button asChild size="sm" variant="outline"><Link to="/action-items"><CheckSquare /> My action items</Link></Button>
            {isAdmin && <UploadTranscriptDialog />}
          </>
        )}
      />

      {isAdmin && reviewCount > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {reviewCount} meeting{reviewCount === 1 ? '' : 's'} waiting for review. Learners see a meeting once you publish it.
        </p>
      )}

      {!isLoading && meetings.length > 0 && (
        <TeamCards meetings={meetings} itemsBy={itemsBy} selected={team} onSelect={chooseTeam} isAdmin={isAdmin} />
      )}

      {team != null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {team === NO_TEAM ? 'Meetings without a team' : `${team} meetings`}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{visible.length}</span>
          </h2>
          <Button size="sm" variant="ghost" onClick={() => chooseTeam(null)}>Show all teams</Button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="meeting-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or participant" className="pl-9" />
        </div>
        {isAdmin && (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <LoadingState label="Loading meetings…" />
        : visible.length === 0 ? (
          <EmptyState
            icon={Presentation}
            title={meetings.length ? 'No meetings match' : 'No meeting notes yet'}
            description={meetings.length ? 'Try another search or status.'
              : isAdmin ? 'Upload a Teams transcript, or choose a Dropbox meetings folder in Integrations.' : 'Notes appear here once an admin publishes them.'}
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((m) => (
              <MeetingRow key={m.id} meeting={m} items={itemsBy.get(m.id) || []} isAdmin={isAdmin} actions={actions} onDelete={setDoomed} />
            ))}
          </ul>
        )}

      <AlertDialog open={!!doomed} onOpenChange={(o) => !o && setDoomed(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{doomed?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its notes, transcript and action items are removed. A transcript synced from Dropbox stays out of future syncs; the file in Dropbox is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => { actions.remove(doomed); setDoomed(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
