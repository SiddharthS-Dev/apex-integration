import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import InviteForm from '@/components/admin/learners/InviteForm';
import InviteResult from '@/components/admin/learners/InviteResult';

// No email service: the API returns a one-time temporary password the admin hands over.
export default function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const onOpenChange = (next) => {
    setOpen(next);
    if (!next) setResult(null);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><UserPlus /> Invite user</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{result ? 'User invited' : 'Invite user'}</DialogTitle>
          <DialogDescription>
            {result
              ? 'Share these sign-in details with the new user through a trusted channel.'
              : 'Creates the account and a temporary password for you to share.'}
          </DialogDescription>
        </DialogHeader>
        {result
          ? <InviteResult result={result} onDone={() => onOpenChange(false)} />
          : <InviteForm onInvited={setResult} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
