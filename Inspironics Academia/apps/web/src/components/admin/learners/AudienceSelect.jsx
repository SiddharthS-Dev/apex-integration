import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AUDIENCES, AUDIENCE_LABEL } from '@/lib/categories';
import { LEARNERS_KEY } from '@/components/admin/learners/learnerData';

// A user's audience decides which playbook categories (and their courses) the API lets them see.
// Administrators see everything whatever their audience.
export default function AudienceSelect({ user }) {
  const queryClient = useQueryClient();
  const value = user.audience || 'employee';
  const save = useMutation({
    mutationFn: (audience) => api.entities.User.update(user.id, { audience }),
    onSuccess: (_r, audience) => {
      toast.success(`${user.full_name || user.email} is now ${AUDIENCE_LABEL[audience]}`);
      queryClient.invalidateQueries({ queryKey: LEARNERS_KEY });
    },
    onError: (err) => toast.error(err?.message || 'Could not change the audience'),
  });
  return (
    // The row opens the learner's details on click; the menu must not.
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
      <Select value={value} onValueChange={(v) => v !== value && save.mutate(v)} disabled={save.isPending}>
        <SelectTrigger className="h-8 w-44 text-xs" aria-label={`Audience for ${user.full_name || user.email}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {AUDIENCES.map((a) => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
