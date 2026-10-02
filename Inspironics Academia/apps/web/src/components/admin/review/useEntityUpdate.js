import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';

// Mutation that updates one entity record and refreshes studio data.
export default function useEntityUpdate(entityName, successMessage) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.entities[entityName].update(id, data),
    onSuccess: () => {
      if (successMessage) toast.success(successMessage);
      queryClient.invalidateQueries({ queryKey: ['studio'] });
    },
    onError: (err) => toast.error(`Update failed: ${err?.message || 'Unknown error'}`),
  });
}
