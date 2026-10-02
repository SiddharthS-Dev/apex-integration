import { forwardRef } from 'react';
import { format } from 'date-fns';
import { GraduationCap } from 'lucide-react';
import { Image } from '@/components/ui/image';

// Printable landscape certificate. The "paper" intentionally stays white in dark mode
// so the on-screen preview matches the printed / PDF output.
const CertificateDocument = forwardRef(function CertificateDocument({ certificate, learnerName, verifyUrl }, ref) {
  const date = certificate.completion_date || certificate.created_date;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(verifyUrl)}`;

  return (
    <div ref={ref} className="certificate-sheet relative w-full aspect-[297/210] bg-white text-slate-900 p-[3%] shadow-xl rounded-sm overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-3 bg-gradient-to-r from-indigo-500 to-violet-600" />
      <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-r from-violet-600 to-indigo-500" />
      <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-indigo-100" />
      <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-violet-100" />
      <div className="relative h-full border-4 border-double border-indigo-300 rounded-sm px-[6%] py-[4%] flex flex-col items-center text-center">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold tracking-tight text-lg">Inspironics Learn</span>
        </div>
        <p className="mt-[3%] text-xs sm:text-sm uppercase tracking-[0.35em] text-indigo-600 font-semibold">Certificate of Completion</p>
        <p className="mt-[2%] text-sm text-slate-500">This certifies that</p>
        <h2 className="mt-1 text-2xl sm:text-4xl font-serif font-bold text-slate-900">{learnerName}</h2>
        <div className="mt-2 h-px w-2/3 bg-gradient-to-r from-transparent via-indigo-300 to-transparent" />
        <p className="mt-[2%] text-sm text-slate-500">has successfully completed the course</p>
        <h3 className="mt-1 text-lg sm:text-2xl font-semibold text-indigo-700 max-w-3xl">{certificate.course_title}</h3>
        <p className="mt-2 text-sm text-slate-600">
          with a final score of <span className="font-semibold text-slate-900">{Math.round(certificate.score || 0)}%</span>
        </p>
        <div className="mt-auto w-full grid grid-cols-3 items-end gap-4 text-xs sm:text-sm">
          <div className="text-left">
            <div className="font-semibold">{date ? format(new Date(date), 'MMMM d, yyyy') : '—'}</div>
            <div className="text-slate-500 border-t border-slate-300 pt-1 mt-1">Date of completion</div>
            <div className="mt-2 font-mono text-[10px] sm:text-xs text-slate-500 break-all">ID: {certificate.certificate_id}</div>
          </div>
          <div className="flex justify-center">
            <Image src={qr} alt="Verification QR code" crossOrigin="anonymous" className="w-20 h-20 sm:w-28 sm:h-28" />
          </div>
          <div className="text-right">
            <div className="font-serif italic text-base sm:text-lg text-indigo-700">Inspironics</div>
            <div className="text-slate-500 border-t border-slate-300 pt-1 mt-1">Inspironics Engineering Academy</div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default CertificateDocument;
