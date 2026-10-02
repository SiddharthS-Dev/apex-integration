import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Unplug } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRefreshIntegrations } from './integrationQueries';

export default function DropboxDisconnectButton() {
  const refresh = useRefreshIntegrations();
  const mutation = useMutation({
    mutationFn: () => api.dropbox.disconnect(),
    onSuccess: () => { toast.success('Dropbox disconnected'); refresh(); },
    onError: (err) => toast.error(err?.message || 'Could not disconnect Dropbox'),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={mutation.isPending}><Unplug /> Disconnect</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect Dropbox?</AlertDialogTitle>
          <AlertDialogDescription>
            Automatic synchronization stops and the stored credentials are revoked. Existing playbooks stay in the library;
            their files remain readable only while cached copies exist.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => mutation.mutate()}>Disconnect</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
