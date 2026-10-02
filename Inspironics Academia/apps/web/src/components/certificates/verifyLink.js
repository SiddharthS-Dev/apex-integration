import { toast } from 'sonner';
import { appPath } from '@/lib/mount';

export const verifyUrlFor = (certificateId) => `${window.location.origin}${appPath(`verify/${certificateId}`)}`;

export async function copyVerifyLink(certificateId) {
  const url = verifyUrlFor(certificateId);
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Verification link copied');
  } catch {
    toast.error('Could not copy link', { description: url });
  }
}
