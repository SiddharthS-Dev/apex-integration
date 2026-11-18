import { AlertTriangle, Info, PlugZap } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import EmptyState from '@/components/EmptyState';
import { coreErrorText } from '@/lib/core';

/** Shown instead of Core screens in the demo build (no API server, so no Core). */
export function CoreUnavailable({ compact = false }) {
  const text = 'People, organisations, roles and account links are managed by the APEX Core API, which this demo build does not include.';
  if (compact) return <p className="text-sm text-muted-foreground">Available when connected to the APEX Core API.</p>;
  return <EmptyState icon={PlugZap} title="Available when connected to the APEX Core API" description={text} />;
}

/** A failed list/detail load, phrased by status (401/403/404/…). */
export function CoreQueryError({ error, title = 'Could not load this' }) {
  return <EmptyState icon={AlertTriangle} title={title} description={coreErrorText(error)} />;
}

/** Short explanatory note above a section. */
export function CoreHint({ title, children }) {
  return (
    <Alert className="bg-muted/40">
      <Info className="w-4 h-4" />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
