import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import {
  Sparkles, X, Send, Eraser, Shuffle, Loader2, Eye, ArrowRight,
} from 'lucide-react';
import { Presentation } from '@/api/entities';
import { InvokeLLM } from '@/api/integrations';
import { getDomain } from '@/lib/domains';
import { cn } from '@/lib/utils';

const CATALOG_LIMIT = 300;
const HISTORY_TURNS = 7;

const SUGGESTIONS = [
  'What should I read to get up to speed on our architecture?',
  'Show me everything about onboarding',
  'Which decks cover AI or machine learning?',
  'What is the most popular presentation this month?',
];

const GREETING = {
  role: 'assistant',
  content:
    "Hi — I'm the **SlidesVault Copilot**. I know every deck in the library: ask me for a topic, a team, a product or a problem you are trying to solve and I'll point you at the right presentations.",
  picks: [],
};

/** Renders the catalog as a numbered index the model can cite by number. */
function buildCatalogText(items) {
  return items
    .map((p, i) => {
      const summary = (p.ai_summary || p.description || '').slice(0, 180);
      return `[${i + 1}] "${p.title}" [${p.primary_domain || 'Uncategorized'} / ${p.sub_domain || '—'}] — ${summary}`;
    })
    .join('\n');
}

function parseReply(raw) {
  if (raw && typeof raw === 'object') {
    return { reply: raw.reply || '', picks: Array.isArray(raw.picks) ? raw.picks : [] };
  }
  if (typeof raw === 'string') {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return { reply: parsed.reply || raw, picks: Array.isArray(parsed.picks) ? parsed.picks : [] };
      } catch {
        /* fall through to plain text */
      }
    }
    return { reply: raw, picks: [] };
  }
  return { reply: 'I could not produce an answer just now — please try again.', picks: [] };
}

function RecommendationCard({ presentation, onOpen }) {
  const domain = getDomain(presentation.primary_domain);
  return (
    <button
      type="button"
      onClick={() => onOpen(presentation.id)}
      className="group flex w-full items-stretch gap-3 overflow-hidden rounded-xl glass text-left transition-shadow hover:shadow-lg"
    >
      <span className={cn('w-1.5 shrink-0 bg-gradient-to-b', domain.gradient)} />
      <span className="min-w-0 flex-1 py-2.5 pr-3">
        <span className="block truncate text-sm font-semibold group-hover:text-primary">
          {presentation.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn('rounded-full bg-gradient-to-r px-1.5 py-0.5 font-medium text-white', domain.gradient)}
          >
            {presentation.primary_domain}
          </span>
          {presentation.sub_domain && <span>{presentation.sub_domain}</span>}
          {(presentation.tags || []).slice(0, 2).map((t) => (
            <span key={t} className="rounded bg-secondary px-1 py-0.5">
              {t}
            </span>
          ))}
          <span className="ml-auto inline-flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {presentation.view_count || 0}
          </span>
        </span>
      </span>
    </button>
  );
}

export default function AiCopilot() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open || catalog.length > 0) return;
    Presentation.filter({ status: 'active' }, '-view_count', CATALOG_LIMIT)
      .then(setCatalog)
      .catch((err) => console.warn('[copilot] catalog load failed', err));
  }, [open, catalog.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const catalogText = useMemo(() => buildCatalogText(catalog), [catalog]);

  const ask = useCallback(
    async (question) => {
      const clean = question.trim();
      if (!clean || busy) return;

      setInput('');
      setMessages((m) => [...m, { role: 'user', content: clean }]);
      setBusy(true);

      const history = messages
        .slice(-HISTORY_TURNS)
        .map((m) => `${m.role === 'user' ? 'User' : 'Copilot'}: ${m.content}`)
        .join('\n');

      const prompt = [
        'You are the SlidesVault Copilot, an assistant inside the Inspironics presentation knowledge hub.',
        'You know only the catalog below. Never invent a presentation that is not listed.',
        'Answer in short, helpful markdown (2-4 sentences max, lists welcome).',
        'Return JSON only, shaped: { "reply": "<markdown>", "picks": [<catalog index numbers, max 5>] }.',
        'Pick the presentations that best answer the question; use an empty array when nothing fits.',
        '',
        '## Catalog',
        catalogText,
        '',
        '## Conversation so far',
        history || '(new conversation)',
        '',
        `## User question\n${clean}`,
      ].join('\n');

      try {
        const raw = await InvokeLLM({
          prompt,
          response_json_schema: {
            type: 'object',
            properties: {
              reply: { type: 'string' },
              picks: { type: 'array', items: { type: 'number' } },
            },
            required: ['reply'],
          },
          // Consumed only by the local backend; ignored by the hosted model.
          __local: { kind: 'copilot', question: clean, catalog },
        });

        const { reply, picks } = parseReply(raw);
        const cards = picks
          .map((n) => catalog[Number(n) - 1])
          .filter(Boolean)
          .slice(0, 5);

        setMessages((m) => [...m, { role: 'assistant', content: reply, picks: cards, query: clean }]);
      } catch (err) {
        console.error('[copilot] failed', err);
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: 'Something went wrong reaching the assistant. Please try again in a moment.',
            picks: [],
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, catalogText, catalog, messages]
  );

  const surprise = useCallback(() => {
    if (catalog.length === 0) return;
    const pick = catalog[Math.floor(Math.random() * catalog.length)];
    setMessages((m) => [
      ...m,
      { role: 'user', content: 'Surprise me' },
      {
        role: 'assistant',
        content: `Try **${pick.title}** — a ${pick.primary_domain} deck from the ${pick.sub_domain} group.`,
        picks: [pick],
      },
    ]);
  }, [catalog]);

  const openPresentation = (id) => {
    setOpen(false);
    navigate(`/presentation/${id}`);
  };

  return (
    <>
      {/* Floating trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the SlidesVault Copilot"
        className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-2xl shadow-violet-600/40 transition-transform hover:scale-105 active:scale-95"
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-violet-500/40" />
        <Sparkles className="relative h-6 w-6" />
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-400" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-background/95 shadow-2xl ring-1 ring-border backdrop-blur-2xl"
            >
              <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white">
                  <Sparkles className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">SlidesVault Copilot</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Online · {catalog.length} decks indexed
                  </span>
                </span>
                <button
                  type="button"
                  onClick={surprise}
                  title="Surprise me"
                  aria-label="Surprise me"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <Shuffle className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMessages([GREETING])}
                  title="Clear conversation"
                  aria-label="Clear conversation"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <Eraser className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close copilot"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {messages.map((m, i) => (
                  <div key={i} className={cn('space-y-2', m.role === 'user' && 'flex justify-end')}>
                    <div
                      className={cn(
                        'max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm',
                        m.role === 'user'
                          ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white'
                          : 'glass'
                      )}
                    >
                      {m.role === 'assistant' ? (
                        <div className="prose-sm space-y-2 [&_a]:text-primary [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        m.content
                      )}
                    </div>

                    {m.picks?.length > 0 && (
                      <div className="space-y-2">
                        {m.picks.map((p) => (
                          <RecommendationCard key={p.id} presentation={p} onOpen={openPresentation} />
                        ))}
                        {m.query && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              navigate(`/library?q=${encodeURIComponent(m.query)}`);
                            }}
                            className="flex items-center gap-1.5 px-1 text-xs text-primary hover:underline"
                          >
                            See all matches in Library <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {busy && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Searching the library…
                  </div>
                )}

                {messages.length <= 1 && !busy && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => ask(s)}
                        className="rounded-full glass px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <footer className="border-t border-border p-3">
                <div className="flex items-end gap-2 rounded-2xl glass p-2">
                  <textarea
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        ask(input);
                      }
                    }}
                    placeholder="Ask about any topic in the library…"
                    className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => ask(input)}
                    disabled={busy || !input.trim()}
                    aria-label="Send message"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  AI can make mistakes — check the deck before relying on it.
                </p>
              </footer>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
