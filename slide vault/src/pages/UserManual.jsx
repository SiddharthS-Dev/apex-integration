import { useState } from 'react';
import { Download, Loader2, BookOpen, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The manual lives here as structured content so the page and the generated PDF
 * never drift apart — both render from CHAPTERS.
 */
const CHAPTERS = [
  {
    title: 'System Overview',
    body: [
      'Inspironics SlidesVault is the company presentation knowledge hub. Every supported file in the connected Dropbox folder is discovered automatically, classified by AI into one of five business domains, given a thumbnail, and made searchable.',
      'Nothing is uploaded by hand. When someone adds a deck to Dropbox it appears in SlidesVault on the next sync; when they delete one, the record is archived rather than destroyed, so history and analytics survive.',
    ],
  },
  {
    title: 'Signing In and Roles',
    body: [
      'Sign in with your work email and password, or with Google. Every page except the sign-in screens requires authentication.',
      'There are two roles. Members can browse, read, download and use the copilot. Admins additionally see the Admin console and Dropbox Settings, and can promote other people to admin.',
    ],
  },
  {
    title: 'Getting Around',
    body: [
      'The header carries the full navigation: Home, Dashboard, Library, Downloads and Manual, plus Admin and Dropbox for administrators. The active item is highlighted with a sliding pill.',
      'On small screens the same items appear in a scrollable row beneath the header. The sun/moon button switches between dark and light themes and remembers your choice.',
    ],
  },
  {
    title: 'The Home Page',
    body: [
      'Home opens with search and a set of shelves: Continue Reading, Recently Viewed, Trending Now, Recently Added and Most Viewed (switchable between today, this week, this month and all time).',
      'Below the shelves, the five domain cards and the popular tag cloud are shortcuts into a pre-filtered Library.',
    ],
  },
  {
    title: 'Searching',
    body: [
      'Press Cmd+K (Ctrl+K on Windows) anywhere to jump into search. Typing matches titles, summaries, domains, sub-domains, tags and keywords at once.',
      'The dropdown shows the six strongest matches with a domain-coloured tile; Enter opens the highlighted one, or press Enter on the last row to see every match in the Library. Your recent searches are kept on this device.',
    ],
  },
  {
    title: 'The Library',
    body: [
      'The Library is the full catalog with filters for sort order, domain, sub-domain, file type, offline availability and popular tags. Every filter is written into the URL, so a filtered view can be bookmarked or shared.',
      'Three layouts are available — grid, list and compact — and your choice is remembered. Results load 24 at a time as you scroll.',
    ],
  },
  {
    title: 'Reading a Presentation',
    body: [
      'Presentations open in a streaming viewer. Use the arrow keys or the Previous/Next buttons to move between pages, and the zoom controls or +/- to change the size. Press F for fullscreen.',
      'The details panel on the left carries the author, slide count, AI summary, learning objectives, your bookmarks and the tags. Press B to bookmark the page you are on.',
    ],
  },
  {
    title: 'Offline Reading',
    body: [
      'Tap Download in the viewer to keep a presentation for offline reading. The file is stored inside the app sandbox — it never lands in your Downloads folder — and it opens instantly the next time, with or without a connection.',
      'The Downloads page shows everything you have saved, how much storage it uses, and lets you remove copies you no longer need. When the device runs low on space the oldest downloads are evicted first.',
    ],
  },
  {
    title: 'Your Dashboard',
    body: [
      'The Dashboard is your personal view: what you have started, what you finished, your average progress and what is available offline.',
      'It also recommends more from whichever domain you read most, and keeps a reading history with progress for each deck.',
    ],
  },
  {
    title: 'The AI Copilot',
    body: [
      'The floating button in the bottom-right corner opens the copilot. It knows the whole catalog, so you can ask for a topic, a team, a product or a problem and get a short answer with tappable recommendation cards.',
      'Each card opens the presentation directly; the "See all matches in Library" link runs the same question as a search. The copilot can be wrong — check the deck before relying on it.',
    ],
  },
  {
    title: 'Content Security',
    body: [
      'Presentations are streamed, not handed over. The viewer hides the browser PDF toolbar, disables the right-click menu and blocks text selection, and printing the application is disabled entirely.',
      'Offline copies are stored as encrypted browser blobs inside the app, so they cannot be forwarded as loose files.',
    ],
  },
  {
    title: 'Admin Console',
    body: [
      'Admins get usage at a glance: total users, active users in the last 24 hours, who is online now, views today and this week, catalog size, storage used and cached files.',
      'Charts cover 14 days of activity and cumulative user growth. Below them sit the most and least viewed decks, the domain distribution, the sync status, user management and the recent sync logs.',
    ],
  },
  {
    title: 'Dropbox Configuration',
    body: [
      'Dropbox Settings is where an admin connects the account, picks the folder to index and runs a sync on demand. The page shows the exact OAuth redirect URI to register in the Dropbox App Console.',
      'Only the long-lived refresh token is stored. Short-lived access tokens are minted per request, held in memory, and never written to the database.',
    ],
  },
];

export default function UserManual() {
  const [generating, setGenerating] = useState(false);

  const downloadPdf = async () => {
    setGenerating(true);
    try {
      const { default: JsPDF } = await import('jspdf');
      const doc = new JsPDF({ unit: 'pt', format: 'a4' });
      const width = doc.internal.pageSize.getWidth();
      const height = doc.internal.pageSize.getHeight();
      const margin = 56;
      const maxWidth = width - margin * 2;

      /* ---- cover ---- */
      doc.setFillColor(12, 14, 28);
      doc.rect(0, 0, width, height, 'F');
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, width, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(34);
      doc.text('Inspironics SlidesVault', margin, 220);
      doc.setFontSize(18);
      doc.setTextColor(167, 139, 250);
      doc.text('User Manual', margin, 254);
      doc.setFontSize(11);
      doc.setTextColor(170, 176, 200);
      doc.text('Presentation Knowledge Hub', margin, 290);
      doc.text(
        `Generated ${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}`,
        margin,
        height - margin
      );

      /* ---- table of contents ---- */
      doc.addPage();
      doc.setTextColor(20, 20, 30);
      doc.setFontSize(20);
      doc.text('Contents', margin, 80);
      doc.setFontSize(11);
      CHAPTERS.forEach((chapter, i) => {
        doc.setTextColor(60, 60, 80);
        doc.text(`${i + 1}.  ${chapter.title}`, margin, 120 + i * 22);
      });

      /* ---- chapters ---- */
      let y = 0;
      const newChapterPage = () => {
        doc.addPage();
        y = 80;
      };

      CHAPTERS.forEach((chapter, i) => {
        newChapterPage();
        doc.setFillColor(79, 70, 229);
        doc.rect(margin, y - 22, 34, 4, 'F');
        doc.setTextColor(20, 20, 30);
        doc.setFontSize(17);
        doc.text(`${i + 1}. ${chapter.title}`, margin, y + 4);
        y += 30;

        doc.setFontSize(11);
        doc.setTextColor(70, 70, 90);
        chapter.body.forEach((paragraph) => {
          const lines = doc.splitTextToSize(paragraph, maxWidth);
          lines.forEach((line) => {
            if (y > height - margin) {
              doc.addPage();
              y = 80;
            }
            doc.text(line, margin, y);
            y += 16;
          });
          y += 10;
        });
      });

      /* ---- page numbers ---- */
      const pages = doc.internal.getNumberOfPages();
      for (let p = 2; p <= pages; p += 1) {
        doc.setPage(p);
        doc.setFontSize(9);
        doc.setTextColor(150, 150, 165);
        doc.text(`${p - 1}`, width / 2, height - 30, { align: 'center' });
        doc.text('Inspironics SlidesVault — User Manual', margin, height - 30);
      }

      doc.save('Inspironics-SlidesVault-User-Manual.pdf');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="relative mb-8 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_20%_0%,rgba(255,255,255,0.25),transparent)]" />
        <div className="absolute -bottom-20 -right-12 h-56 w-56 rounded-full bg-fuchsia-400/40 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-9 sm:px-10">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/25 backdrop-blur">
              <BookOpen className="h-3.5 w-3.5" /> User Manual
            </p>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Everything SlidesVault can do
            </h1>
            <p className="mt-2 max-w-xl text-sm text-white/80">
              Thirteen short chapters covering navigation, search, offline reading, security and the
              admin controls.
            </p>
          </div>
          <Button variant="glass" onClick={downloadPdf} disabled={generating} className="shrink-0 bg-white/15 text-white ring-white/25">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download PDF
          </Button>
        </div>
      </div>

      {/* Table of contents */}
      <nav className="mb-8 rounded-2xl glass p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Contents
        </h2>
        <ol className="grid gap-0.5 sm:grid-cols-2">
          {CHAPTERS.map((chapter, i) => (
            <li key={chapter.title}>
              <a
                href={`#chapter-${i + 1}`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <span className="w-5 shrink-0 text-right font-mono text-xs opacity-60">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-8">
        {CHAPTERS.map((chapter, i) => (
          <section key={chapter.title} id={`chapter-${i + 1}`} className="scroll-mt-32">
            <h2 className="flex items-baseline gap-2.5 text-lg font-semibold tracking-tight">
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-xs font-bold text-white'
                )}
              >
                {i + 1}
              </span>
              {chapter.title}
            </h2>
            <div className="mt-3 space-y-3 border-l border-border pl-5">
              {chapter.body.map((paragraph, j) => (
                <p key={j} className="text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
