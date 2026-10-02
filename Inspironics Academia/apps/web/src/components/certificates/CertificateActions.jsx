import { useState } from 'react';
import { Copy, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { copyVerifyLink } from '@/components/certificates/verifyLink';

async function downloadPdf(element, fileName) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
  pdf.save(fileName);
}

export default function CertificateActions({ targetRef, certificate }) {
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    if (!targetRef.current) return;
    setBusy(true);
    try {
      await downloadPdf(targetRef.current, `certificate-${certificate.certificate_id || certificate.course_id}.pdf`);
    } catch (e) {
      toast.error('Could not create PDF', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
      <Button size="sm" onClick={onDownload} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
      </Button>
      <Button size="sm" variant="outline" onClick={() => copyVerifyLink(certificate.certificate_id)}>
        <Copy /> Copy verify link
      </Button>
    </div>
  );
}
