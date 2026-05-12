'use client';

import { useState } from 'react';
import type { AgentDetail, OutputSchemaKind, ProviderId } from '@/lib/api';

interface Props {
  /** Provided when editing an existing agent. */
  initial?: AgentDetail;
  /** Server action — receives a FormData and persists. */
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  /** True when the agent is builtin → name/kind/id are read-only. */
  isBuiltin?: boolean;
  /** Submit button label. */
  submitLabel?: string;
}

const PROVIDERS: { value: ProviderId; label: string; defaultModel: string }[] = [
  { value: 'claude', label: 'Anthropic Claude', defaultModel: 'claude-opus-4-7' },
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4.1' },
  { value: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash' },
  { value: 'mock', label: 'Mock (test only)', defaultModel: 'mock-1' },
];

const KIND_DESCRIPTIONS: Record<OutputSchemaKind, string> = {
  text: 'Freeform reasoning. Use for early-stage agents that summarize or generate hypotheses.',
  analysis:
    'Structured intermediate output: a list of matched patterns and notes. Bounded, easier for downstream agents to consume.',
  finding:
    'Final structured Finding (severity, summary, evidence, recommendation, impact). Must be the LAST agent of a pipeline.',
};

export function AgentForm({ initial, action, isBuiltin = false, submitLabel = 'Save agent' }: Props) {
  const [provider, setProvider] = useState<ProviderId>(initial?.provider ?? 'gemini');
  const [model, setModel] = useState<string>(
    initial?.model ?? PROVIDERS.find((p) => p.value === 'gemini')!.defaultModel,
  );
  const [kind, setKind] = useState<OutputSchemaKind>(initial?.output_schema_kind ?? 'text');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      action={async (fd) => {
        setError(null);
        setPending(true);
        try {
          const result = await action(fd);
          if (result && 'error' in result && result.error) setError(result.error);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setPending(false);
        }
      }}
      className="space-y-5"
    >
      <Field label="Name" required>
        <input
          name="name"
          defaultValue={initial?.name}
          required
          disabled={isBuiltin}
          placeholder="Evidence Collector"
          className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
        />
      </Field>

      <Field label="Description (optional)">
        <input
          name="description"
          defaultValue={initial?.description ?? ''}
          disabled={isBuiltin}
          placeholder="What this agent does in one line"
          className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
        />
      </Field>

      <Field label="Provider" required>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PROVIDERS.map((p) => (
            <label
              key={p.value}
              className={`cursor-pointer rounded border px-3 py-2 text-xs ${
                provider === p.value
                  ? 'border-argus-accent bg-argus-accent/10 text-argus-accent'
                  : 'border-argus-border bg-argus-bg text-slate-300 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="provider"
                value={p.value}
                className="sr-only"
                checked={provider === p.value}
                onChange={() => {
                  setProvider(p.value);
                  // Suggest a default model when switching provider.
                  setModel(p.defaultModel);
                }}
              />
              {p.label}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Model" required>
        <input
          name="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
          placeholder="model id (e.g. claude-opus-4-7)"
          className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-argus-muted">
          Provider switching above suggests a default; override for free-tier models, fine-tunes, or
          self-hosted endpoints.
        </p>
      </Field>

      <Field label="System prompt" required>
        <textarea
          name="system_prompt"
          defaultValue={initial?.system_prompt}
          required
          rows={6}
          placeholder="You are an evidence collector. Read the events and list..."
          className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
        />
      </Field>

      <Field label="User prompt template (optional, advanced)">
        <textarea
          name="user_prompt_template"
          defaultValue={initial?.user_prompt_template ?? ''}
          rows={3}
          placeholder="Appended to the auto-generated user block. Use to give per-pipeline instructions."
          className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
        />
      </Field>

      <Field label="Output schema kind" required>
        <div className="space-y-2">
          {(['text', 'analysis', 'finding'] as const).map((k) => (
            <label
              key={k}
              className={`block cursor-pointer rounded border px-3 py-2 text-sm ${
                kind === k
                  ? 'border-argus-accent bg-argus-accent/10'
                  : 'border-argus-border bg-argus-bg hover:border-slate-600'
              } ${isBuiltin ? 'opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="output_schema_kind"
                value={k}
                className="sr-only"
                checked={kind === k}
                disabled={isBuiltin}
                onChange={() => setKind(k)}
              />
              <span className="font-medium capitalize text-slate-100">{k}</span>
              <span className="ml-2 text-xs text-argus-muted">{KIND_DESCRIPTIONS[k]}</span>
            </label>
          ))}
        </div>
      </Field>

      {error && (
        <div className="rounded border border-argus-danger/40 bg-argus-danger/5 p-3 text-sm text-argus-danger">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {isBuiltin && (
          <span className="text-xs text-argus-muted">
            Builtin agents are partially read-only. Edit prompt + model, but not the schema kind.
          </span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-argus-accent bg-argus-accent/10 px-4 py-2 text-sm font-medium text-argus-accent hover:bg-argus-accent/20 disabled:opacity-50"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
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
