'use client';

import { useState } from 'react';
import type { LlmCredentialDetail, ProviderId } from '@/lib/api';

const PROVIDERS: Array<{ value: ProviderId; label: string; defaultModel: string; example: string }> = [
  { value: 'claude', label: 'Anthropic Claude', defaultModel: 'claude-opus-4-7', example: 'sk-ant-…' },
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4.1', example: 'sk-…' },
  { value: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', example: 'AIza…' },
];

interface Props {
  initial?: LlmCredentialDetail;
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  submitLabel?: string;
}

export function CredentialForm({ initial, action, submitLabel = 'Save credential' }: Props) {
  const [provider, setProvider] = useState<ProviderId>(initial?.provider ?? 'gemini');
  const initialModel =
    initial?.default_model ?? PROVIDERS.find((p) => p.value === provider)?.defaultModel ?? '';
  const [model, setModel] = useState<string>(initialModel);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const providerSpec = PROVIDERS.find((p) => p.value === provider);

  return (
    <form
      action={async (fd) => {
        setError(null);
        setPending(true);
        fd.set('provider', provider);
        fd.set('default_model', model);
        try {
          const r = await action(fd);
          if (r && 'error' in r && r.error) setError(r.error);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setPending(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      <Field label="Display name" required>
        <input
          name="name"
          defaultValue={initial?.name}
          required
          placeholder="Team Gemini · production"
          className="w-full rounded border bg-bg-bg-2 px-3 py-2 text-sm"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            color: 'var(--fg-0)',
          }}
        />
      </Field>

      <Field label="Provider" required>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {PROVIDERS.map((p) => (
            <label
              key={p.value}
              className="cursor-pointer rounded px-3 py-2 text-sm"
              style={{
                border: '1px solid',
                borderColor: provider === p.value ? 'var(--blue)' : 'var(--line)',
                background:
                  provider === p.value
                    ? 'color-mix(in oklch, var(--blue) 12%, var(--bg-2))'
                    : 'var(--bg-2)',
                color: provider === p.value ? 'var(--blue)' : 'var(--fg-1)',
              }}
            >
              <input
                type="radio"
                value={p.value}
                checked={provider === p.value}
                className="sr-only"
                disabled={!!initial}
                onChange={() => {
                  setProvider(p.value);
                  setModel(p.defaultModel);
                }}
              />
              {p.label}
            </label>
          ))}
        </div>
        {initial && (
          <p className="mono text-fg-3 mt-1" style={{ fontSize: 11 }}>
            Provider is locked once a credential is created.
          </p>
        )}
      </Field>

      <Field label="API key" required={!initial}>
        <input
          name="api_key"
          type="password"
          defaultValue={initial ? '__REDACTED__' : ''}
          placeholder={providerSpec?.example ?? '…'}
          required={!initial}
          className="w-full rounded px-3 py-2 mono text-sm"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            color: 'var(--fg-0)',
          }}
        />
        <p className="text-fg-3 mt-1" style={{ fontSize: 11 }}>
          Stored in the DB. Redacted on read — leaving as <code className="mono">__REDACTED__</code>{' '}
          preserves the stored value when you save.
        </p>
      </Field>

      <Field label="Default model">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={providerSpec?.defaultModel ?? '…'}
          className="w-full rounded px-3 py-2 mono text-sm"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            color: 'var(--fg-0)',
          }}
        />
        <p className="text-fg-3 mt-1" style={{ fontSize: 11 }}>
          Used by agents that don&apos;t pick a specific model. Override on the agent if you need to.
        </p>
      </Field>

      <Field label="Notes (optional)">
        <textarea
          name="notes"
          defaultValue={initial?.notes ?? ''}
          rows={2}
          placeholder="e.g. Production key — cost-tracked."
          className="w-full rounded px-3 py-2 text-sm"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            color: 'var(--fg-0)',
          }}
        />
      </Field>

      <label className="inline-flex items-center gap-2 text-sm text-fg-1">
        <input
          type="checkbox"
          name="is_default"
          defaultChecked={initial?.is_default ?? false}
          className="accent-blue"
        />
        Use as default for {provider} agents (only one default per provider).
      </label>

      {error && (
        <div
          className="rounded p-3 text-sm"
          style={{
            border: '1px solid color-mix(in oklch, var(--rose) 40%, var(--line))',
            background: 'color-mix(in oklch, var(--rose) 6%, var(--bg-1))',
            color: 'var(--rose)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="ds-btn primary lg">
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="uppercase-mini text-fg-3 mb-1 block">
        {label}
        {required && <span className="text-rose"> *</span>}
      </label>
      {children}
    </div>
  );
}
