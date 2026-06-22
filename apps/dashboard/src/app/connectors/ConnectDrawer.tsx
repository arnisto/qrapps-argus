'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { CatalogEntry, CatalogField } from '@/lib/connectors-server';
import { IconClose } from '@/components/shell/icons';

interface ConnectResult {
  id?: string;
  tables_indexed?: number;
  chunks_indexed?: number;
  errors?: string[];
  test_summary?: { tables_visible?: number; version?: string };
}

export function ConnectDrawer({
  envSlug,
  entry,
  onClose,
  onConnected,
}: {
  envSlug: string;
  entry: CatalogEntry;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const available = entry.status === 'available';

  // Lock body scroll while the drawer is open; ESC dismisses.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!available) return;
    setError(null);
    setResult(null);
    setSubmitting(true);

    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('__name') ?? '').trim();
    if (!name) {
      setError('Give this connection a name first.');
      setSubmitting(false);
      return;
    }

    const config: Record<string, unknown> = {};
    const secret: Record<string, unknown> = {};
    for (const f of entry.fields) {
      const raw = fd.get(f.name);
      if (raw === null || raw === '') continue;
      const value = f.type === 'number' ? Number(raw) : String(raw);
      (f.bucket === 'secret' ? secret : config)[f.name] = value;
    }

    try {
      const res = await fetch(
        `/be/envs/${encodeURIComponent(envSlug)}/env-connectors`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subtype: entry.subtype, name, config, secret }),
        },
      );
      const data = (await res.json().catch(() => null)) as
        | { connector?: ConnectResult; error?: string; message?: string }
        | null;
      if (!res.ok || !data?.connector) {
        throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      }
      setResult(data.connector);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex animate-fade"
      onClick={onClose}
    >
      <div className="flex-1 bg-text/40" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[480px] h-[100dvh] bg-surface border-l border-border shadow-modal flex flex-col"
      >
        <header className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-md bg-inset border border-border flex items-center justify-center font-mono text-sm font-bold text-text-2 flex-none">
              {entry.icon}
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-text">{entry.name}</div>
              <div className="text-xs text-text-2 mt-0.5 leading-snug">{entry.tagline}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-none w-8 h-8 rounded-md text-text-2 hover:text-text hover:bg-inset transition flex items-center justify-center"
            aria-label="Close"
          >
            <IconClose size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!available ? (
            <div className="rounded-md border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-text-2">
              <strong className="text-amber">Coming soon.</strong>{' '}
              {entry.whatItUnlocks}
            </div>
          ) : null}

          {result ? (
            <ConnectResultPanel result={result} entry={entry} onContinue={onConnected} />
          ) : (
            <form id="connect-form" onSubmit={onSubmit} className="space-y-3" noValidate>
              <FieldRow
                field={{
                  name: '__name',
                  label: 'Connection name',
                  type: 'text',
                  bucket: 'config',
                  placeholder: `e.g. ${entry.subtype}-prod`,
                  hint: 'Just for you — what should this connection appear as in your env?',
                  required: true,
                }}
                disabled={!available}
              />
              <div className="h-px bg-border my-2" />
              {entry.fields.map((f) => (
                <FieldRow key={f.name} field={f} disabled={!available} />
              ))}
            </form>
          )}
        </div>

        <footer className="border-t border-border p-4">
          {error ? (
            <div className="mb-3 text-sm text-red bg-red-soft border border-red/30 rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
          {!result ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-2xs text-text-3 leading-snug flex-1">
                {entry.whatItUnlocks}
              </p>
              <button
                type="submit"
                form="connect-form"
                disabled={!available || submitting}
                className="rounded-md bg-accent text-white font-semibold px-4 py-2 text-sm hover:opacity-90 disabled:opacity-40 transition flex-none"
              >
                {submitting ? 'Connecting…' : `Connect ${entry.name}`}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onConnected}
              className="w-full rounded-md bg-accent text-white font-semibold px-4 py-2 text-sm hover:opacity-90 transition"
            >
              Done
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}

function FieldRow({ field, disabled }: { field: CatalogField; disabled: boolean }) {
  const labelCls =
    'block text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1';
  const inputCls =
    'block w-full rounded-md bg-surface-2 border border-border px-3 py-2 text-sm text-text outline-none placeholder:text-text-3 focus:border-accent focus:shadow-focus transition disabled:opacity-50';

  return (
    <label className="block">
      <span className={labelCls}>{field.label}</span>
      {field.type === 'select' ? (
        <select
          name={field.name}
          defaultValue={(field.default as string) ?? ''}
          required={field.required}
          disabled={disabled}
          className={inputCls}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          name={field.name}
          defaultValue={(field.default as string) ?? ''}
          placeholder={field.placeholder}
          required={field.required}
          disabled={disabled}
          rows={3}
          className={`${inputCls} resize-y min-h-[80px]`}
        />
      ) : (
        <input
          name={field.name}
          type={field.type}
          defaultValue={field.default as string | number | undefined}
          placeholder={field.placeholder}
          required={field.required}
          disabled={disabled}
          autoComplete={field.secret ? 'new-password' : 'off'}
          className={inputCls}
        />
      )}
      {field.hint ? (
        <span className="block text-xs text-text-3 mt-1 leading-snug">{field.hint}</span>
      ) : null}
    </label>
  );
}

function ConnectResultPanel({
  result,
  entry,
  onContinue,
}: {
  result: ConnectResult;
  entry: CatalogEntry;
  onContinue: () => void;
}) {
  const tablesIndexed = result.tables_indexed ?? 0;
  const chunks = result.chunks_indexed ?? tablesIndexed;
  const errors = result.errors ?? [];
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-green/40 bg-green-soft px-3 py-3">
        <div className="text-2xs font-semibold uppercase tracking-wider text-green mb-1">
          ✓ Connected
        </div>
        <p className="text-sm text-text-1">
          {entry.name} is now indexing for this env.
        </p>
        {tablesIndexed > 0 ? (
          <div className="mt-2 font-mono text-2xs text-text-2">
            {tablesIndexed} {entry.kind === 'db' ? 'table' : 'item'}
            {tablesIndexed === 1 ? '' : 's'} indexed · {chunks} chunk
            {chunks === 1 ? '' : 's'} embedded
          </div>
        ) : null}
        {result.test_summary?.version ? (
          <div className="mt-1 font-mono text-2xs text-text-3 truncate">
            {result.test_summary.version}
          </div>
        ) : null}
      </div>
      {errors.length > 0 ? (
        <div className="rounded-md border border-amber/40 bg-amber-soft px-3 py-2 text-2xs text-text-2">
          <div className="font-semibold uppercase tracking-wider text-amber mb-1">
            {errors.length} item{errors.length === 1 ? '' : 's'} skipped
          </div>
          <ul className="font-mono space-y-0.5 max-h-32 overflow-auto">
            {errors.slice(0, 8).map((e, i) => (
              <li key={i}>· {e}</li>
            ))}
            {errors.length > 8 ? <li>· … +{errors.length - 8} more</li> : null}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-text-2 leading-relaxed">
        Head over to <strong>Ask Argus</strong> — try a question about a table you know
        exists. The reply will cite the schema chunks Argus just indexed.
      </p>
      <button
        type="button"
        onClick={onContinue}
        className="w-full rounded-md bg-accent text-white font-semibold px-4 py-2 text-sm hover:opacity-90 transition"
      >
        Done
      </button>
    </div>
  );
}
