export const AXIS_TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };

export const TOOLTIP_PROPS = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 12,
    fontSize: 12,
    color: 'hsl(var(--foreground))',
  },
  cursor: { fill: 'hsl(var(--muted))', opacity: 0.4 },
};

export default function ChartCard({ title, description, empty, children }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="h-64 mt-4">
        {empty ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
