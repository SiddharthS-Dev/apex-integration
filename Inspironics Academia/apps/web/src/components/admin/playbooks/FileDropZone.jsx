import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function FileDropZone({ onFile, uploading, label, maxMb = 50, compact = false }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <button
      type="button"
      disabled={uploading}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'w-full rounded-2xl border-2 border-dashed flex flex-col items-center text-center transition-colors',
        compact ? 'p-4 gap-2' : 'p-8 gap-3',
        dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50',
        uploading && 'opacity-70 cursor-wait',
      )}
    >
      <div className={cn('rounded-xl bg-primary/10 text-primary flex items-center justify-center', compact ? 'w-9 h-9' : 'w-12 h-12')}>
        {uploading ? <Loader2 className={cn('animate-spin', compact ? 'w-5 h-5' : 'w-6 h-6')} /> : <FileUp className={compact ? 'w-5 h-5' : 'w-6 h-6'} />}
      </div>
      <div className={cn('font-medium', compact && 'text-sm')}>{label || 'Drop a playbook here or click to browse'}</div>
      <div className="text-xs text-muted-foreground">PDF or DOCX, up to {maxMb} MB</div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </button>
  );
}
