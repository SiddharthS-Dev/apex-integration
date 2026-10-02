import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const errorMessage = (e, fallback = 'Something went wrong. Please try again.') =>
  e?.response?.data?.message || e?.data?.message || e?.message || fallback;

export default function FormError({ message }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle className="w-4 h-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
