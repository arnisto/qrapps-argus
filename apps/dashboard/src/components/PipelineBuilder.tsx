'use client';

import { useMemo, useState } from 'react';
import type { Agent, AlertChannel, OutputSchemaKind } from '@/lib/api';

interface Props {
  /** All available agents (from GET /v1/agents). */
  availableAgents: Agent[];
  /** All available alert channels (from GET /v1/alert-channels). */
  alertChannels: AlertChannel[];
  /** Pre-populated when editing. */
  initial?: PipelineInitial;
  /** Locked when editing a builtin investigator. */
  isBuiltin?: boolean;
  /** Server action receiving FormData. */
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  submitLabel?: string;
}

export interface PipelineInitial {
  id: string;
  name: string;
  description: string;
  triggers: { events: string[]; schedule?: string };
  context: { lookback: string; related_events: string[]; max_events: number };
  severity_threshold: 'none' | 'low' | 'medium' | 'high' | 'critical';
  output: { alert_channels: string[] };
  agents: Array<{ agent_id: string; position: number }>;
}

const KIND_BADGE: Record<OutputSchemaKind, string> = {
  text: 'bg-slate-800 text-slate-300 border-slate-700',
  analysis: 'bg-sky-950 text-sky-300 border-sky-900',
  finding: 'bg-emerald-950 text-emerald-300 border-emerald-900',
};

export function PipelineBuilder({
  availableAgents,
  alertChannels,
  initial,
  isBuiltin = false,
  action,
  submitLabel = 'Save investigator',
}: Props) {
  const [pipeline, setPipeline] = useState<string[]>(
    initial ? initial.agents.sort((a, b) => a.position - b.position).map((a) => a.agent_id) : [],
  );
  const [adderOpen, setAdderOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const byId = useMemo(() => new Map(availableAgents.map((a) => [a.id, a])), [availableAgents]);
  const validation = validate(pipeline.map((id) => byId.get(id)?.output_schema_kind));

  return (
    <form
      action={async (fd) => {
        setError(null);
        if (validation) {
          setError(validation);
          return;
        }
        setPending(true);
        fd.set('agents', JSON.stringify(pipeline));
        try {
          const result = await action(fd);
          if (result && 'error' in result && result.error) setError(result.error);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setPending(false);
        }
      }}
      className="space-y-6"
    >
      <section className="space-y-4 rounded border border-argus-border bg-argus-panel p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">Header</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ID (slug)" required>
            <input
              name="id"
              defaultValue={initial?.id}
              required
              disabled={isBuiltin || !!initial}
              placeholder="ghost-delivery-v2"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
            />
          </Field>

          <Field label="Name" required>
            <input
              name="name"
              defaultValue={initial?.name}
              required
              disabled={isBuiltin}
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
            />
          </Field>
        </div>

        <Field label="Description" required>
          <textarea
            name="description"
            defaultValue={initial?.description}
            required
            disabled={isBuiltin}
            rows={2}
            className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Trigger event types (comma-separated)">
            <input
              name="triggers_events"
              defaultValue={initial?.triggers.events.join(', ') ?? 'delivery.completed'}
              disabled={isBuiltin}
              placeholder="delivery.completed, refund.requested"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
            />
          </Field>

          <Field label="Schedule (cron, optional)">
            <input
              name="triggers_schedule"
              defaultValue={initial?.triggers.schedule ?? ''}
              disabled={isBuiltin}
              placeholder="*/15 * * * *"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Lookback">
            <input
              name="context_lookback"
              defaultValue={initial?.context.lookback ?? '24h'}
              disabled={isBuiltin}
              placeholder="24h"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
            />
          </Field>

          <Field label="Max events">
            <input
              name="context_max_events"
              type="number"
              defaultValue={initial?.context.max_events ?? 400}
              min={1}
              max={2000}
              disabled={isBuiltin}
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
            />
          </Field>

          <Field label="Severity threshold">
            <select
              name="severity_threshold"
              defaultValue={initial?.severity_threshold ?? 'medium'}
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </Field>
        </div>

        <Field label="Related event types (comma-separated)">
          <input
            name="context_related_events"
            defaultValue={initial?.context.related_events.join(', ') ?? ''}
            disabled={isBuiltin}
            placeholder="gps.ping, refund.requested"
            className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
          />
        </Field>

        <Field label="Alert channels">
          <div className="flex flex-wrap gap-2">
            {alertChannels.length === 0 ? (
              <span className="text-xs text-argus-muted">No channels available.</span>
            ) : (
              alertChannels.map((c) => (
                <label
                  key={c.id}
                  className="cursor-pointer rounded border border-argus-border bg-argus-bg px-3 py-1.5 text-xs text-slate-300 hover:border-argus-accent has-[input:checked]:border-argus-accent has-[input:checked]:bg-argus-accent/10 has-[input:checked]:text-argus-accent"
                >
                  <input
                    type="checkbox"
                    name="alert_channels"
                    value={c.id}
                    defaultChecked={initial?.output.alert_channels.includes(c.id) ?? false}
                    className="sr-only"
                  />
                  {c.name} <span className="font-mono opacity-70">({c.id})</span>
                </label>
              ))
            )}
          </div>
        </Field>
      </section>

      <section className="space-y-3 rounded border border-argus-border bg-argus-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">
            Pipeline ({pipeline.length} agent{pipeline.length === 1 ? '' : 's'})
          </h2>
          <button
            type="button"
            onClick={() => setAdderOpen((v) => !v)}
            className="rounded border border-argus-border px-3 py-1 text-xs text-slate-300 hover:border-argus-accent hover:text-argus-accent"
          >
            + Add agent
          </button>
        </div>

        {pipeline.length === 0 && (
          <p className="text-xs text-argus-muted">
            No agents yet. Add at least one — and the last must be of kind <code>finding</code>.
          </p>
        )}

        <ol className="space-y-2">
          {pipeline.map((agentId, idx) => {
            const agent = byId.get(agentId);
            return (
              <li
                key={`${agentId}-${idx}`}
                className="flex items-center gap-3 rounded border border-argus-border bg-argus-bg p-3"
              >
                <span className="font-mono text-xs text-argus-muted">#{idx + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">{agent?.name ?? agentId}</span>
                    {agent && (
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${KIND_BADGE[agent.output_schema_kind]}`}
                      >
                        {agent.output_schema_kind}
                      </span>
                    )}
                  </div>
                  {agent && (
                    <div className="font-mono text-xs text-argus-muted">
                      {agent.provider} · {agent.model}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(setPipeline, idx, -1)}
                    disabled={idx === 0}
                    className="rounded border border-argus-border px-2 py-1 text-xs text-slate-300 hover:border-argus-accent disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(setPipeline, idx, +1)}
                    disabled={idx === pipeline.length - 1}
                    className="rounded border border-argus-border px-2 py-1 text-xs text-slate-300 hover:border-argus-accent disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setPipeline((p) => p.filter((_, i) => i !== idx))}
                    className="rounded border border-argus-border px-2 py-1 text-xs text-argus-danger hover:border-argus-danger"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        {adderOpen && (
          <div className="rounded border border-argus-border bg-argus-bg p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-argus-muted">Pick an agent</div>
            <div className="space-y-1">
              {availableAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setPipeline((p) => [...p, a.id]);
                    setAdderOpen(false);
                  }}
                  className="w-full rounded border border-transparent px-2 py-1 text-left text-xs hover:border-argus-border hover:bg-argus-panel"
                >
                  <span className="font-medium text-slate-100">{a.name}</span>{' '}
                  <span className="font-mono text-argus-muted">({a.id})</span>{' '}
                  <span
                    className={`ml-2 inline-block rounded border px-1 font-mono text-[10px] uppercase ${KIND_BADGE[a.output_schema_kind]}`}
                  >
                    {a.output_schema_kind}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {validation && (
          <div className="rounded border border-argus-warn/40 bg-argus-warn/5 p-2 text-xs text-argus-warn">
            {validation}
          </div>
        )}
      </section>

      {error && (
        <div className="rounded border border-argus-danger/40 bg-argus-danger/5 p-3 text-sm text-argus-danger">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || !!validation}
          className="rounded border border-argus-accent bg-argus-accent/10 px-4 py-2 text-sm font-medium text-argus-accent hover:bg-argus-accent/20 disabled:opacity-50"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function move(setter: React.Dispatch<React.SetStateAction<string[]>>, idx: number, delta: -1 | 1): void {
  setter((p) => {
    const next = p.slice();
    const target = idx + delta;
    if (target < 0 || target >= next.length) return p;
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    return next;
  });
}

function validate(kinds: (OutputSchemaKind | undefined)[]): string | null {
  if (kinds.length === 0) return 'Pipeline must have at least one agent.';
  if (kinds.some((k) => k === undefined)) return 'One or more selected agents could not be loaded.';
  const last = kinds[kinds.length - 1];
  if (last !== 'finding') return `The last agent must be of kind 'finding' (current last is '${last}').`;
  for (let i = 0; i < kinds.length - 1; i++) {
    if (kinds[i] === 'finding') return `Only the last agent may be of kind 'finding' (position ${i} is).`;
  }
  return null;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-argus-muted">
        {label}
        {required && <span className="ml-1 text-argus-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
