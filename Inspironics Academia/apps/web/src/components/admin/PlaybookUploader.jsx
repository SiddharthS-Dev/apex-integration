import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SKILL_LABEL, SKILL_LEVELS, useCategories } from '@/lib/categories';
import FileDropZone from '@/components/admin/playbooks/FileDropZone';
import { runPlaybookPipeline } from '@/lib/pipeline';
import useAppConfig from '@/lib/useAppConfig';

function validate(file, maxMb) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext !== 'pdf' && ext !== 'docx') return { error: 'Only .pdf and .docx files are supported' };
  if (file.size > maxMb * 1024 * 1024) return { error: `File exceeds the ${maxMb} MB limit` };
  return { ext };
}

export default function PlaybookUploader({ compact = false, className }) {
  const queryClient = useQueryClient();
  const { max_upload_mb: maxMb } = useAppConfig();
  const [processNow, setProcessNow] = useState(true);
  // Who the playbook is for. "Not sure" leaves it unclassified, for an admin to review.
  const { categories } = useCategories();
  const [category, setCategory] = useState('unsure');
  const [skill, setSkill] = useState('none');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['playbooks'] });

  const upload = useMutation({
    mutationFn: async ({ file, ext }) => {
      const uploaded = await api.files.upload(file);
      return api.entities.Playbook.create({
        title: file.name.replace(/\.[^.]+$/, ''),
        file_url: uploaded.file_uri,
        file_name: uploaded.file_name || file.name,
        file_type: ext,
        file_size: uploaded.size ?? file.size,
        source: 'upload',
        status: 'uploaded',
        ...(category !== 'unsure' ? { category } : {}),
        ...(skill !== 'none' ? { skill_level: skill } : {}),
      });
    },
    onSuccess: async (playbook) => {
      toast.success(`Uploaded “${playbook.title}”`);
      refresh();
      if (!processNow) return;
      toast.info('Processing started — extracting chapters…');
      const result = await runPlaybookPipeline(playbook.id);
      if (result.ok) toast.success(`Course structure built for “${playbook.title}”`);
      else if (result.skipped) toast.info('Structure skipped: an active course already exists');
      else toast.error(`Processing failed: ${result.error}`);
      refresh();
    },
    onError: (err) => toast.error(`Upload failed: ${err?.message || 'Unknown error'}`),
  });

  const handleFile = (file) => {
    const { ext, error } = validate(file, maxMb);
    if (error) return toast.error(error);
    upload.mutate({ file, ext });
  };

  return (
    <div className={className ?? 'rounded-2xl border border-border bg-card p-5 space-y-4'}>
      <FileDropZone onFile={handleFile} uploading={upload.isPending} label={upload.isPending ? 'Uploading…' : undefined} maxMb={maxMb} compact={compact} />
      <div className={compact ? 'mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-2' : 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]'}>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Category" className="h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}{c.audience_label ? ` — ${c.audience_label}` : ''}</SelectItem>)}
            <SelectItem value="unsure">Not sure — send to review</SelectItem>
          </SelectContent>
        </Select>
        <Select value={skill} onValueChange={setSkill}>
          <SelectTrigger aria-label="Skill level" className="h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Any level</SelectItem>
            {SKILL_LEVELS.map((k) => <SelectItem key={k} value={k}>{SKILL_LABEL[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className={compact ? 'flex items-center gap-2 mt-3' : 'flex items-center gap-2'}>
        <Checkbox id="process-now" checked={processNow} onCheckedChange={(v) => setProcessNow(v === true)} />
        <Label htmlFor="process-now" className={compact ? 'text-xs font-normal' : 'text-sm font-normal'}>Process immediately (extract chapters and build course)</Label>
      </div>
    </div>
  );
}
