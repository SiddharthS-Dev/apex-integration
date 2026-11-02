import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { isMeetingFile } from '@academy/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import FileDropZone from '@/components/admin/playbooks/FileDropZone';
import useAppConfig from '@/lib/useAppConfig';
import { useInvalidateMeetings } from '@/lib/meetings';
import { cn } from '@/lib/utils';

const ACCEPT = '.docx,.vtt,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/vtt,text/plain';
const STEPS = [
  ['upload', 'Upload the transcript'],
  ['process', 'Read speakers and find decisions, requirements and action items'],
  ['done', 'Ready for review'],
];

// Upload a Teams transcript, then analyse it straight away; opens the meeting when it's ready.
export default function UploadTranscriptDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(null);
  const navigate = useNavigate();
  const refresh = useInvalidateMeetings();
  const { max_upload_mb: maxMb = 50, ai_enabled: ai } = useAppConfig();
  const busy = step === 'upload' || step === 'process';

  const onFile = async (file) => {
    if (!isMeetingFile(file.name)) {
      toast.error('Upload a Teams transcript: .docx, .vtt or .txt');
      return;
    }
    let meeting;
    try {
      setStep('upload');
      meeting = await api.meetings.upload(file);
      setStep('process');
      const { data } = await api.functions.invoke('processMeeting', { meeting_id: meeting.id });
      setStep('done');
      refresh();
      toast.success('Transcript analysed', { description: `${data.action_item_count} action item${data.action_item_count === 1 ? '' : 's'} found. Review, then publish.` });
      setOpen(false);
      setStep(null);
      navigate(`/meetings/${meeting.id}`);
    } catch (e) {
      refresh();
      toast.error(e?.message || 'Could not process the transcript');
      setStep(null);
      if (meeting) {
        setOpen(false);
        navigate(`/meetings/${meeting.id}`);
      }
    }
  };

  const at = STEPS.findIndex(([k]) => k === step);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Upload /> Upload transcript</Button>
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload a meeting transcript</DialogTitle>
            <DialogDescription>
              The Word file Teams gives you (Download transcript → .docx), or a .vtt/.txt export. Transcripts saved in the Dropbox meetings folder are picked up automatically.
            </DialogDescription>
          </DialogHeader>
          {step ? (
            <ol className="space-y-3 py-2" aria-live="polite">
              {STEPS.map(([k, label], i) => (
                <li key={k} className={cn('flex items-center gap-3 text-sm', i > at && 'text-muted-foreground')}>
                  {i < at || step === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : i === at ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Circle className="h-4 w-4" />}
                  {label}
                  {k === 'process' && i === at && ai && <span className="text-xs text-muted-foreground">— up to a minute for a long meeting</span>}
                </li>
              ))}
            </ol>
          ) : (
            <FileDropZone onFile={onFile} uploading={busy} maxMb={maxMb} accept={ACCEPT} hint="Word (.docx), .vtt or .txt" label="Drop a transcript here or click to browse" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
