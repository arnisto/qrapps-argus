'use client';

import { useState, type FormEvent } from 'react';

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
  'What is our refund policy?',
  'How fast do we deliver?',
  'Who is the owner?',
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

  async function send(query: string) {
    const text = query.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    const next: ChatTurn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setDraft('');
    try {
      const res = await fetch(`/be/envs/${encodeURIComponent(envSlug)}/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = (await res.json()) as AskResponse & { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      const content = data.choices?.[0]?.message?.content ?? '(no content)';
      setTurns([
        ...next,
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
      // Drop the user turn that failed so the next attempt starts clean.
      setTurns(turns);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(draft);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-surface shadow-card min-h-[420px] flex flex-col">
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {turns.length === 0 ? (
            <EmptyState onPick={(s) => send(s)} />
          ) : (
            turns.map((t, i) => <Bubble key={i} turn={t} />)
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
            className="flex-none w-10 h-10 rounded-md bg-accent text-white font-semibold flex items-center justify-center hover:opacity-90 disabled:opacity-30 disabled:bg-inset disabled:text-text-3 transition"
            aria-label="Send"
          >
            ↑
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
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      <svg
        width="36"
        height="36"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden
        className="mb-3"
      >
        <circle cx="11" cy="11" r="8.2" stroke="var(--accent)" strokeWidth="1.6" />
        <circle cx="11" cy="11" r="3" fill="var(--accent)" />
      </svg>
      <h2 className="text-xl font-semibold text-text">Ask your company brain</h2>
      <p className="text-sm text-text-2 mt-1 max-w-md">
        Argus will answer ONLY from what you've taught it. If it doesn't know,
        it'll say so plainly.
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

function Bubble({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[15px_15px_4px_15px] bg-accent text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className="flex-none w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 22 22" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="8.2" stroke="var(--accent)" strokeWidth="1.6" />
          <circle cx="11" cy="11" r="3" fill="var(--accent)" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="rounded-[4px_15px_15px_15px] bg-surface border border-border px-4 py-3 text-sm whitespace-pre-wrap text-text">
          {turn.content}
        </div>
        {turn.warning === 'no_grounded_context' ? (
          <div className="mt-2 text-2xs font-semibold text-amber bg-amber-soft border border-amber/30 rounded-sm px-2 py-1 inline-block">
            ⚠ no grounded context — Argus had nothing in the knowledge core for this one
          </div>
        ) : null}
        {turn.citations && turn.citations.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="font-mono text-2xs font-semibold text-green uppercase tracking-wider">
              grounded:
            </span>
            {turn.citations.map((c) => (
              <CitationChip key={c.chunk_id} citation={c} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CitationChip({ citation }: { citation: Citation }) {
  return (
    <span
      title={`score ${citation.score} · chunk ${citation.chunk_id.slice(0, 8)}`}
      className="inline-flex items-center gap-1 font-mono text-2xs text-text-2 bg-inset border border-border rounded-sm px-1.5 py-0.5"
    >
      <span className="text-accent font-semibold">[#{citation.index}]</span>
      <span className="truncate max-w-[180px]">{citation.source_title}</span>
    </span>
  );
}

function TypingBubble() {
  return (
    <div className="flex gap-3">
      <div className="flex-none w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 22 22" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="8.2" stroke="var(--accent)" strokeWidth="1.6" />
        </svg>
      </div>
      <div className="rounded-[4px_15px_15px_15px] bg-surface border border-border px-4 py-3 inline-flex items-center gap-1">
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
