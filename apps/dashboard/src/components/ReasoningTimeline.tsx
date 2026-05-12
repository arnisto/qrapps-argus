'use client';

import { useState } from 'react';
import type { AgentRun, InvestigationDetail } from '@/lib/api';

interface Props {
  investigation: InvestigationDetail;
  agentRuns: AgentRun[];
}

const STATUS_STYLES: Record<AgentRun['status'], string> = {
  running: 'bg-amber-950 text-amber-300 border-amber-900',
  succeeded: 'bg-emerald-950 text-emerald-300 border-emerald-900',
  failed: 'bg-red-950 text-red-300 border-red-900',
};

type Tab = 'system' | 'user' | 'output';

export function ReasoningTimeline({ investigation, agentRuns }: Props) {
  if (agentRuns.length === 0) {
    return (
      <p className="text-xs text-argus-muted">
        Single-call investigation — no agent reasoning trail. Migrate this investigator to a pipeline
        to see step-by-step reasoning.
      </p>
    );
  }

  const totalTin = agentRuns.reduce((s, r) => s + (r.tokens_input ?? 0), 0);
  const totalTout = agentRuns.reduce((s, r) => s + (r.tokens_output ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-argus-muted">
        <span>
          {agentRuns.length} agent{agentRuns.length === 1 ? '' : 's'} · {investigation.status}
        </span>
        <span>
          {totalTin.toLocaleString()} in / {totalTout.toLocaleString()} out tokens
        </span>
      </div>
      <ol className="space-y-2">
        {agentRuns.map((run) => (
          <AgentRunBox key={run.id} run={run} />
        ))}
      </ol>
    </div>
  );
}

function AgentRunBox({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('output');

  const duration =
    run.finished_at && run.started_at
      ? Math.max(0, new Date(run.finished_at).getTime() - new Date(run.started_at).getTime())
      : null;

  return (
    <li className="rounded border border-argus-border bg-argus-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-argus-bg/50"
      >
        <span className="font-mono text-xs text-argus-muted">#{run.position + 1}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-100">
              {run.agent_name ?? run.agent_id}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_STYLES[run.status]}`}
            >
              {run.status}
            </span>
          </div>
          <div className="font-mono text-xs text-argus-muted">
            {run.provider} · {run.model}
            {duration !== null && <> · {(duration / 1000).toFixed(1)}s</>}
            {run.tokens_input != null && (
              <>
                {' '}· {run.tokens_input}in / {run.tokens_output ?? 0}out
              </>
            )}
          </div>
        </div>
        <span className="text-argus-muted">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-argus-border px-4 py-3">
          {run.error && (
            <div className="mb-3 rounded border border-argus-danger/40 bg-argus-danger/5 p-2 text-xs text-argus-danger">
              <span className="font-mono">{run.error}</span>
            </div>
          )}

          <div className="mb-2 flex gap-1 border-b border-argus-border">
            {(['system', 'user', 'output'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-1 text-xs ${
                  tab === t
                    ? 'border-argus-accent text-argus-accent'
                    : 'border-transparent text-argus-muted hover:text-slate-300'
                }`}
              >
                {t === 'system' ? 'System prompt' : t === 'user' ? 'User prompt' : 'Output'}
              </button>
            ))}
          </div>

          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-argus-bg p-3 font-mono text-xs leading-relaxed text-slate-300">
            {tab === 'system'
              ? run.system_prompt_rendered
              : tab === 'user'
                ? run.user_prompt_rendered
                : run.output_json !== null && run.output_json !== undefined
                  ? JSON.stringify(run.output_json, null, 2)
                  : run.output_text || '(empty)'}
          </pre>
        </div>
      )}
    </li>
  );
}
