import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Wraps a (possibly disabled) control. When `reason` is set, hovering shows why it is unavailable.
// Disabled buttons swallow pointer events, so the tooltip trigger is a wrapping span.
export default function DisabledReason({ reason, children, className = 'inline-flex' }) {
  if (!reason) return children;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className={className}>{children}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
