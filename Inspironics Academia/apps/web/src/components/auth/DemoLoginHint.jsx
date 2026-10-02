import { Info } from 'lucide-react';
import { backendKind } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';

const ACCOUNTS = [
  { email: 'admin@demo.local', label: 'Admin' },
  { email: 'learner@demo.local', label: 'Learner' },
];

// Demo backend only: lists the seeded accounts (any password works for them).
export default function DemoLoginHint({ onPick }) {
  if (backendKind !== 'demo') return null;
  return (
    <Alert className="mb-4">
      <Info className="w-4 h-4" />
      <AlertDescription>
        Demo mode — sign in as{' '}
        {ACCOUNTS.map((a, i) => (
          <span key={a.email}>
            {i > 0 && ' or '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => onPick(a.email)}>{a.email}</button>
          </span>
        ))}{' '}
        with any password.
      </AlertDescription>
    </Alert>
  );
}
