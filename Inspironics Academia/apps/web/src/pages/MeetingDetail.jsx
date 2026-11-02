import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, Clock, Cloud, Download, Eye, EyeOff, FileDown, FileSpreadsheet, Loader2, Pencil, RefreshCw, Upload, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import { AnalysisNote, AvatarStack, MeetingStatus } from '@/components/meetings/MeetingBits';
import { OverviewTab, QuestionsRisksTab, RequirementsTab } from '@/components/meetings/InsightTabs';
import ActionItemsTab from '@/components/meetings/ActionItemsTab';
import TranscriptTab from '@/components/meetings/TranscriptTab';
import ParticipationTab from '@/components/meetings/ParticipationTab';
import useMeetingActions from '@/components/meetings/useMeetingActions';
import ConfirmDeleteButton from '@/components/admin/editor/ConfirmDeleteButton';
import { useAuth } from '@/lib/AuthContext';
import {
  actionItemsCsv, downloadText, fileSafe, formatDay, formatMinutes, isOpen, minutesMarkdown, useInvalidateMeetings, useMeeting,
  useMeetingActionItems, useTranscript,
} from '@/lib/meetings';

function EditMeetingDialog({ meeting, open, onOpenChange }) {
  const refresh = useInvalidateMeetings();
  const [form, setForm] = useState({ title: meeting.title || '', meeting_date: meeting.meeting_date || '', team: meeting.team || '', purpose: meeting.purpose || '', summary: meeting.summary || '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    if (!form.title.trim()) return toast.error('Give the meeting a title');
    setSaving(true);
    try {
      await api.entities.Meeting.update(meeting.id, { ...form, title: form.title.trim(), team: form.team.trim() });
      toast.success('Meeting updated');
      refresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
    return null;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Edit meeting notes</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="grid gap-1.5"><Label htmlFor="m-title">Title</Label><Input id="m-title" value={form.title} onChange={set('title')} /></div>
            <div className="grid gap-1.5"><Label htmlFor="m-date">Date</Label><Input id="m-date" type="date" value={form.meeting_date} onChange={set('meeting_date')} /></div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-team">Team</Label>
            <Input id="m-team" value={form.team} onChange={set('team')} placeholder="e.g. HMS — groups the meeting under that team's card" />
          </div>
          <div className="grid gap-1.5"><Label htmlFor="m-purpose">Purpose</Label><Textarea id="m-purpose" rows={2} value={form.purpose} onChange={set('purpose')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="m-summary">Summary</Label><Textarea id="m-summary" rows={7} value={form.summary} onChange={set('summary')} /></div>
          <p className="text-xs text-muted-foreground">Reprocessing the transcript rewrites these fields; edited action items are kept.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminToolbar({ meeting, items }) {
  const actions = useMeetingActions();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const working = actions.busy?.endsWith(meeting.id);
  const processed = ['needs_review', 'published'].includes(meeting.status);
  const download = () => {
    const a = document.createElement('a');
    a.href = api.meetings.contentUrl(meeting.id);
    a.download = meeting.file_name || `${fileSafe(meeting.title)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-muted/40 p-3">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin</span>
      <Button size="sm" variant="outline" disabled={working} onClick={() => actions.process(meeting)}>
        {actions.busy === `process:${meeting.id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {meeting.status === 'uploaded' || meeting.status === 'failed' ? 'Process transcript' : 'Reprocess'}
      </Button>
      {processed && (meeting.status === 'published'
        ? <Button size="sm" variant="outline" disabled={working} onClick={() => actions.publish(meeting, false)}><EyeOff /> Unpublish</Button>
        : <Button size="sm" disabled={working} onClick={() => actions.publish(meeting, true)}><Eye /> Publish</Button>)}
      <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={!processed}><Pencil /> Edit notes</Button>
      <Button size="sm" variant="ghost" onClick={download} disabled={!meeting.file_url}><Download /> Original</Button>
      <Button size="sm" variant="ghost" disabled={!processed} onClick={() => downloadText(`${fileSafe(meeting.title)} - minutes.md`, minutesMarkdown(meeting, items), 'text/markdown;charset=utf-8')}>
        <FileDown /> Export minutes
      </Button>
      <Button size="sm" variant="ghost" disabled={!items.length} onClick={() => downloadText(`${fileSafe(meeting.title)} - action items.csv`, actionItemsCsv(items), 'text/csv;charset=utf-8')}>
        <FileSpreadsheet /> Action items CSV
      </Button>
      <span className="ml-auto">
        <ConfirmDeleteButton
          label="Delete meeting"
          disabled={working}
          title={`Delete “${meeting.title}”?`}
          description="Its notes, transcript and action items are removed. A transcript synced from Dropbox comes back on the next sync unless you remove it there too."
          onConfirm={async () => { if (await actions.remove(meeting)) navigate('/meetings'); }}
        />
      </span>
      {editing && <EditMeetingDialog meeting={meeting} open={editing} onOpenChange={setEditing} />}
    </div>
  );
}

export default function MeetingDetail() {
  const { meetingId } = useParams();
  const { isAdmin } = useAuth();
  const { data: meeting, isLoading, error } = useMeeting(meetingId);
  const transcript = useTranscript(meetingId);
  const { data: items = [] } = useMeetingActionItems(meetingId);
  const [tab, setTab] = useState('overview');
  const [focusTime, setFocusTime] = useState(null);

  if (isLoading) return <LoadingState label="Loading meeting…" />;
  if (error || !meeting) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState title="Meeting not found" description="It may not be published yet, or it was removed." action={<Button asChild size="sm" variant="outline"><Link to="/meetings">All meetings</Link></Button>} />
      </div>
    );
  }

  const processed = ['needs_review', 'published'].includes(meeting.status);
  const openCount = items.filter(isOpen).length;
  const jump = (time) => {
    setFocusTime(time ?? null);
    setTab('transcript');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <Link to="/meetings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Meetings</Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{meeting.title}</h1>
          {isAdmin && <MeetingStatus status={meeting.status} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {meeting.team && (
            <Link to={`/meetings?team=${encodeURIComponent(meeting.team)}`} className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/15">
              {meeting.team} team
            </Link>
          )}
          {meeting.meeting_date && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDay(meeting.meeting_date)}</span>}
          {meeting.duration_minutes > 0 && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" />{formatMinutes(meeting.duration_minutes)}</span>}
          {meeting.participants?.length > 0 && (
            <span className="inline-flex items-center gap-2"><Users className="h-4 w-4" /><AvatarStack names={meeting.participants} max={6} /><span>{meeting.participants.join(', ')}</span></span>
          )}
          <span className="inline-flex items-center gap-1.5">
            {meeting.source === 'dropbox' ? <Cloud className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {meeting.source === 'dropbox' ? 'From Dropbox' : 'Uploaded'}
          </span>
        </div>
        <AnalysisNote method={meeting.analysis_method} />
        {meeting.status === 'failed' && meeting.error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{meeting.error}</p>
        )}
      </header>

      {isAdmin && <AdminToolbar meeting={meeting} items={items} />}

      {!processed ? (
        <EmptyState
          icon={meeting.status === 'processing' ? Loader2 : RefreshCw}
          title={meeting.status === 'processing' ? 'Analysing the transcript…' : 'Not analysed yet'}
          description={isAdmin ? 'Process the transcript to find decisions, requirements and action items.' : 'Notes appear here once they are ready.'}
        />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="actions">Action items <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{openCount}/{items.length}</span></TabsTrigger>
              <TabsTrigger value="requirements">Requirements <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{meeting.requirements?.length || 0}</span></TabsTrigger>
              <TabsTrigger value="questions">Questions & risks</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="participation">Participation</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="overview" className="pt-4"><OverviewTab meeting={meeting} /></TabsContent>
          <TabsContent value="actions" className="pt-4"><ActionItemsTab meeting={meeting} items={items} onJump={jump} /></TabsContent>
          <TabsContent value="requirements" className="pt-4"><RequirementsTab meeting={meeting} /></TabsContent>
          <TabsContent value="questions" className="pt-4"><QuestionsRisksTab meeting={meeting} /></TabsContent>
          <TabsContent value="transcript" className="pt-4">
            <TranscriptTab transcript={transcript.data} isLoading={transcript.isLoading} participants={meeting.participants || []} focusTime={focusTime} />
          </TabsContent>
          <TabsContent value="participation" className="pt-4"><ParticipationTab meeting={meeting} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
