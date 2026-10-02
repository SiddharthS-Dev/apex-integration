import { Loader2 } from 'lucide-react';

export default function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin text-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
