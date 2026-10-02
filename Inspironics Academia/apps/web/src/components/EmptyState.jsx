import { Inbox } from 'lucide-react';

export default function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-xl bg-muted text-muted-foreground flex items-center justify-center">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
