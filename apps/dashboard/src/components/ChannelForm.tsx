'use client';

import { useState } from 'react';
import type { AlertChannel, AlertChannelType, Severity } from '@/lib/api';

interface Props {
  /** When editing, the existing channel row. Type is locked once chosen. */
  initial?: AlertChannel;
  /** For new channels: which type was picked on the previous step. */
  initialType?: AlertChannelType;
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  submitLabel?: string;
}

const SEVERITY_OPTIONS: Severity[] = ['low', 'medium', 'high', 'critical'];

export function ChannelForm({ initial, initialType, action, submitLabel = 'Save channel' }: Props) {
  const type = initial?.type ?? initialType ?? 'slack';
  const initialConfig = (initial?.config ?? {}) as Record<string, unknown>;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      action={async (fd) => {
        setError(null);
        setPending(true);
        try {
          fd.set('type', type);
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
      <section className="space-y-4 rounded border border-argus-border bg-argus-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">
            Channel — <span className="text-argus-accent">{type}</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ID (slug)">
            <input
              name="id"
              defaultValue={initial?.id}
              disabled={!!initial}
              placeholder={`${type}.ops`}
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
            />
          </Field>
          <Field label="Display name" required>
            <input
              name="name"
              defaultValue={initial?.name}
              required
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
            />
          </Field>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={initial?.enabled ?? true}
            className="accent-argus-accent"
          />
          Enabled (channel receives findings when on)
        </label>

        <Field label="Minimum severity">
          <select
            name="min_severity"
            defaultValue={(initialConfig['min_severity'] as string) ?? 'low'}
            className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-argus-muted">
            Findings below this severity are silently skipped for this channel — no alerts row is
            written. Set <code className="font-mono">critical</code> on an exec email channel to
            avoid noise.
          </p>
        </Field>
      </section>

      {(type === 'slack' || type === 'discord') && (
        <section className="space-y-4 rounded border border-argus-border bg-argus-panel p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">
            {type === 'slack' ? 'Slack webhook' : 'Discord webhook'}
          </h2>
          <Field label="Webhook URL (direct — kept in DB)">
            <input
              name="webhook_url"
              defaultValue={(initialConfig['webhook_url'] as string) ?? ''}
              placeholder={
                type === 'slack'
                  ? 'https://hooks.slack.com/services/...'
                  : 'https://discord.com/api/webhooks/...'
              }
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none"
            />
          </Field>
          <Field label="OR webhook URL env var (recommended — secret stays out of DB)">
            <input
              name="webhook_url_env"
              defaultValue={(initialConfig['webhook_url_env'] as string) ?? ''}
              placeholder="ARGUS_SLACK_WEBHOOK_URL"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-argus-muted">
              Set this to the name of an env var on the workers container. Either this OR the
              direct URL above must resolve at dispatch time.
            </p>
          </Field>
        </section>
      )}

      {type === 'webhook' && (
        <section className="space-y-4 rounded border border-argus-border bg-argus-panel p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">
            HMAC-signed webhook
          </h2>
          <Field label="Target URL" required>
            <input
              name="url"
              defaultValue={(initialConfig['url'] as string) ?? ''}
              required
              placeholder="https://hooks.example.com/argus"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none"
            />
          </Field>
          <Field label="Signing secret env var (recommended)">
            <input
              name="secret_env"
              defaultValue={(initialConfig['secret_env'] as string) ?? ''}
              placeholder="ARGUS_WEBHOOK_SECRET"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-argus-muted">
              The env var holds the shared secret. Argus sends{' '}
              <code className="font-mono">X-Argus-Signature: sha256=&lt;hmac&gt;</code> over the
              body so receivers can verify. Leave empty to send unsigned (dev only).
            </p>
          </Field>
        </section>
      )}

      {error && (
        <div className="rounded border border-argus-danger/40 bg-argus-danger/5 p-3 text-sm text-argus-danger">
          {error}
        </div>
      )}

      <div className="flex justify-end">
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
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-argus-muted">
        {label}
        {required && <span className="ml-1 text-argus-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
