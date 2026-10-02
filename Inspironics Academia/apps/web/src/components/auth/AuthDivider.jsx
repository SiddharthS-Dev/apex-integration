export default function AuthDivider({ label = 'or' }) {
  return (
    <div className="flex items-center gap-3 my-5 text-xs uppercase tracking-wide text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      {label}
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
