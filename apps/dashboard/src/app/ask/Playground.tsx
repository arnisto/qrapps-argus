'use client';

import { useState, type FormEvent } from 'react';
import { BrandMark, IconSend, IconSparkle } from '@/components/shell/icons';
import { QaForm } from '../teach/QaForm';

interface Citation {
  index: number;
  chunk_id: string;
  source_id: string;
  source_title: string;
  source_kind: string;
  score: number;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  warning?: 'no_grounded_context';
}

interface AskResponse {
  choices: Array<{ message: { content: string } }>;
  argus_citations?: Citation[];
  argus_warning?: 'no_grounded_context';
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  _argus?: { latency_ms: number; cost_usd_estimate: number };
}

const SUGGESTIONS = [
  'What is our SLA?',
  'Who is the owner?',
  'Do you offer same-day pickup?',
];

export function Playground({ envSlug }: { envSlug: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<
    | { latency_ms: number; tokens: number; cost: number }
    | null
  >(null);
  const [openTeacher, setOpenTeacher] = useState<string | null>(null);
  const [inspectChunk, setInspectChunk] = useState<Citation | null>(null);

  /**
   * Sends `text` against the env's chat endpoint and appends both the user
   * turn and the assistant reply (or restores the draft on failure so the
   * buyer doesn't lose what they typed).
   */
  async function send(text: string) {
    const query = text.trim();
    if (!query || busy) return;
    setError(null);
    setBusy(true);
    const optimistic: ChatTurn[] = [...turns, { role: 'user', content: query }];
    setTurns(optimistic);
    setDraft('');
    try {
      const res = await fetch(`/be/envs/${encodeURIComponent(envSlug)}/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: optimistic.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = (await res.json()) as AskResponse & { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      const content = data.choices?.[0]?.message?.content ?? '(no content)';
      setTurns([
        ...optimistic,
        {
          role: 'assistant',
          content,
          citations: data.argus_citations ?? [],
          warning: data.argus_warning,
        },
      ]);
      if (data._argus && data.usage) {
        setMeta({
          latency_ms: data._argus.latency_ms,
          tokens: data.usage.total_tokens,
          cost: data._argus.cost_usd_estimate,
        });
      }
    } catch (err) {
      setError((err as Error).message);
      setTurns(turns); // drop the optimistic user bubble
      setDraft(query); // restore so the user can retry without retyping
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(draft);
  }

  /**
   * Called by the inline teacher when the user fills in an answer to a
   * question Argus missed: refire the original question so the buyer sees
   * the system answer correctly.
   */
  async function onTaught(question: string) {
    setOpenTeacher(null);
    // small UX touch — wait a tick so the success toast in QaForm can render
    // before the new assistant turn arrives
    await new Promise((r) => setTimeout(r, 250));
    await send(question);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-surface shadow-card min-h-[460px] flex flex-col">
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {turns.length === 0 ? (
            <EmptyState onPick={(s) => send(s)} />
          ) : (
            turns.map((t, i) => (
              <Bubble
                key={i}
                turn={t}
                envSlug={envSlug}
                teacherOpen={openTeacher === String(i)}
                onOpenTeacher={() => setOpenTeacher(String(i))}
                onCloseTeacher={() => setOpenTeacher(null)}
                onTaught={onTaught}
                onInspectChunk={setInspectChunk}
                lastUserQuestion={
                  turns[i - 1]?.role === 'user' ? turns[i - 1]!.content : ''
                }
              />
            ))
          )}
          {busy ? <TypingBubble /> : null}
        </div>
        <form
          onSubmit={onSubmit}
          className="border-t border-border bg-bg rounded-b-2xl p-3 flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder="Ask anything that's covered by your knowledge core…"
            rows={2}
            className="flex-1 resize-none bg-transparent text-sm text-text outline-none placeholder:text-text-3 py-2 px-2"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="flex-none w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center hover:opacity-90 disabled:opacity-30 disabled:bg-inset disabled:text-text-3 transition"
            aria-label="Send"
          >
            <IconSend size={16} />
          </button>
        </form>
      </div>
      {error ? (
        <div className="text-sm text-red bg-red-soft border border-red/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}
      {meta ? (
        <div className="font-mono text-2xs text-text-3 flex flex-wrap gap-3">
          <span>last reply: {meta.latency_ms}ms</span>
          <span>·</span>
          <span>{meta.tokens} tokens</span>
          <span>·</span>
          <span>${meta.cost.toFixed(6)}</span>
        </div>
      ) : null}
      {inspectChunk ? (
        <ChunkInspector citation={inspectChunk} onClose={() => setInspectChunk(null)} />
      ) : null}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      <h2 className="text-xl font-semibold text-text">Ask your company brain</h2>
      <p className="text-sm text-text-2 mt-1.5 max-w-md">
        Argus will answer ONLY from what you've taught it. If it doesn't know,
        it'll say so plainly — and you can teach it the answer right here.
      </p>
      <div className="flex gap-2 mt-5 flex-wrap justify-center">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg border border-border bg-surface text-text-2 hover:text-text hover:bg-inset px-3 py-1.5 text-xs transition"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({
  turn,
  envSlug,
  teacherOpen,
  onOpenTeacher,
  onCloseTeacher,
  onTaught,
  onInspectChunk,
  lastUserQuestion,
}: {
  turn: ChatTurn;
  envSlug: string;
  teacherOpen: boolean;
  onOpenTeacher: () => void;
  onCloseTeacher: () => void;
  onTaught: (q: string) => void;
  onInspectChunk: (c: Citation) => void;
  lastUserQuestion: string;
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-accent text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className="flex-none w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center">
        <BrandMark size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-4 py-3 text-sm whitespace-pre-wrap text-text">
          {turn.content}
        </div>

        {turn.warning === 'no_grounded_context' ? (
          <div className="mt-3 rounded-xl border border-amber/40 bg-amber-soft p-3">
            <div className="flex items-start gap-2.5">
              <IconSparkle size={16} className="text-amber mt-0.5 flex-none" />
              <div className="flex-1 min-w-0">
                <div className="text-2xs font-semibold uppercase tracking-wider text-amber mb-1">
                  Knowledge gap
                </div>
                <p className="text-xs text-text-2 leading-relaxed">
                  Argus doesn't have an answer for this in the knowledge core yet.
                  Teach it now and Argus will use that answer next time anyone asks.
                </p>
                {!teacherOpen ? (
                  <button
                    type="button"
                    onClick={onOpenTeacher}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-amber text-white text-xs font-semibold px-3 py-1.5 hover:opacity-90 transition"
                  >
                    Teach Argus the answer →
                  </button>
                ) : null}
              </div>
            </div>
            {teacherOpen ? (
              <div className="mt-3 pt-3 border-t border-amber/30">
                <QaForm
                  envSlug={envSlug}
                  initialQuestion={lastUserQuestion}
                  onTaught={(q) => onTaught(q)}
                />
                <button
                  type="button"
                  onClick={onCloseTeacher}
                  className="mt-2 text-2xs text-text-3 hover:text-text-2 underline-offset-4 hover:underline"
                >
                  cancel
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {turn.citations && turn.citations.length > 0 ? (
          <div className="mt-3">
            <div className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1.5">
              Grounded in
            </div>
            <div className="flex flex-wrap gap-1.5">
              {turn.citations.map((c) => (
                <CitationButton key={c.chunk_id} citation={c} onInspect={onInspectChunk} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CitationButton({
  citation,
  onInspect,
}: {
  citation: Citation;
  onInspect: (c: Citation) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInspect(citation)}
      title={`Click to inspect · score ${citation.score}`}
      className="inline-flex items-center gap-1 font-mono text-2xs text-text-2 bg-inset border border-border hover:border-accent hover:text-text hover:bg-accent-soft rounded-sm px-1.5 py-0.5 transition"
    >
      <span className="text-accent font-semibold">[#{citation.index}]</span>
      <span className="truncate max-w-[200px]">{citation.source_title}</span>
    </button>
  );
}

function ChunkInspector({
  citation,
  onClose,
}: {
  citation: Citation;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-text/40 animate-fade"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] rounded-2xl border border-border bg-surface shadow-modal p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1">
              Citation [#{citation.index}]
            </div>
            <div className="text-base font-semibold text-text">
              {citation.source_title}
            </div>
            <div className="font-mono text-2xs text-text-3 mt-0.5">
              {citation.source_kind} · score {citation.score} · chunk{' '}
              {citation.chunk_id.slice(0, 8)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-none w-8 h-8 rounded-md bg-inset border border-border text-text-2 hover:text-text hover:bg-bg transition"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="text-sm text-text-2 leading-relaxed">
          Open <strong>{citation.source_kind === 'qa' ? 'Teach Argus' : 'Knowledge'}</strong>{' '}
          for this env to see the full chunk content. Chunk text inspection lands as a
          dedicated endpoint in M6 — until then, the source title + score + chunk id
          uniquely identify what Argus grounded on.
        </div>
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex gap-3">
      <div className="flex-none w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center">
        <BrandMark size={18} />
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-4 py-3 inline-flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-text-3 animate-blink"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
    </div>
  );
}
