'use client';

import { useState } from 'react';
import type {
  ConnectorDetail,
  ConnectorTestResult,
  PostgresConnectorConfig,
  PostgresConnectorMapping,
} from '@/lib/api';

interface Props {
  initial?: ConnectorDetail;
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  /**
   * Test-the-current-form-values action. When editing an existing connector,
   * the form passes the connector id alongside the config so the server can
   * splice the stored password if the password field still shows `__REDACTED__`.
   */
  testAction: (
    config: PostgresConnectorConfig,
    connectorId?: string,
  ) => Promise<ConnectorTestResult>;
  submitLabel?: string;
}

const DEFAULT_MAPPING = (): PostgresConnectorMapping => ({
  table: '',
  event_type: '',
  fields: { id: 'id' },
  cursor: { column: 'updated_at', strategy: 'gt' },
});

const DEFAULT_CONFIG = (): PostgresConnectorConfig => ({
  connection: {
    host: '',
    port: 5432,
    database: '',
    user: '',
    password: '',
    ssl: false,
  },
  mappings: [DEFAULT_MAPPING()],
  poll_interval_ms: 30_000,
  batch_size: 1000,
});

export function ConnectorForm({
  initial,
  action,
  testAction,
  submitLabel = 'Save connector',
}: Props) {
  const [config, setConfig] = useState<PostgresConnectorConfig>(
    initial?.config ?? DEFAULT_CONFIG(),
  );
  const [testResult, setTestResult] = useState<ConnectorTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateConn = (patch: Partial<PostgresConnectorConfig['connection']>) =>
    setConfig((c) => ({ ...c, connection: { ...c.connection, ...patch } }));

  const updateMapping = (idx: number, patch: Partial<PostgresConnectorMapping>) =>
    setConfig((c) => ({
      ...c,
      mappings: c.mappings.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    }));

  return (
    <form
      action={async (fd) => {
        setError(null);
        setPending(true);
        // Stringify the full config into a hidden field so the server action
        // gets the structured object back, avoiding a flat-key encoding mess.
        fd.set('config_json', JSON.stringify(config));
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
        <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">Identity</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ID (slug, optional — derived from name)">
            <input
              name="id"
              defaultValue={initial?.id}
              disabled={!!initial}
              placeholder="prod-orders"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none disabled:opacity-50"
            />
          </Field>
          <Field label="Name" required>
            <input
              name="name"
              defaultValue={initial?.name}
              required
              placeholder="Production orders DB"
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
          Enabled (polls every {Math.round((config.poll_interval_ms ?? 30000) / 1000)}s when on)
        </label>
      </section>

      <section className="space-y-4 rounded border border-argus-border bg-argus-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">
            Postgres connection
          </h2>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={config.connection.ssl}
              onChange={(e) => updateConn({ ssl: e.target.checked })}
              className="accent-argus-accent"
            />
            SSL/TLS (cloud / managed Postgres)
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Host" required>
            <input
              value={config.connection.host}
              onChange={(e) => updateConn({ host: e.target.value })}
              required
              placeholder="db.example.com or host.docker.internal"
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
            />
          </Field>
          <Field label="Port" required>
            <input
              type="number"
              value={config.connection.port}
              onChange={(e) => updateConn({ port: Number(e.target.value) })}
              required
              min={1}
              max={65535}
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
            />
          </Field>
          <Field label="Database" required>
            <input
              value={config.connection.database}
              onChange={(e) => updateConn({ database: e.target.value })}
              required
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
            />
          </Field>
          <Field label="User (must be read-only)" required>
            <input
              value={config.connection.user}
              onChange={(e) => updateConn({ user: e.target.value })}
              required
              className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
            />
          </Field>
        </div>
        <Field label="Password" required>
          <input
            type="password"
            value={config.connection.password}
            onChange={(e) => updateConn({ password: e.target.value })}
            required={!initial}
            placeholder={initial ? '(unchanged — leave as __REDACTED__ or replace)' : ''}
            className="w-full rounded border border-argus-border bg-argus-bg px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-argus-muted">
            Argus refuses to start a connector whose user has any DML/DDL privilege. Test the
            connection below — failure modes are surfaced before save.
          </p>
        </Field>
      </section>

      <section className="space-y-3 rounded border border-argus-border bg-argus-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">
            Table → event mappings ({config.mappings.length})
          </h2>
          <button
            type="button"
            onClick={() =>
              setConfig((c) => ({ ...c, mappings: [...c.mappings, DEFAULT_MAPPING()] }))
            }
            className="rounded border border-argus-border px-3 py-1 text-xs text-slate-300 hover:border-argus-accent hover:text-argus-accent"
          >
            + Add mapping
          </button>
        </div>

        {config.mappings.map((m, idx) => (
          <MappingEditor
            key={idx}
            idx={idx}
            mapping={m}
            onChange={(patch) => updateMapping(idx, patch)}
            onRemove={() =>
              setConfig((c) => ({
                ...c,
                mappings: c.mappings.filter((_, i) => i !== idx),
              }))
            }
            disableRemove={config.mappings.length === 1}
          />
        ))}
      </section>

      <section className="rounded border border-argus-border bg-argus-panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-argus-muted">
            Test connection
          </h2>
          <button
            type="button"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                const result = await testAction(config, initial?.id);
                setTestResult(result);
              } catch (e) {
                setTestResult({ ok: false, error: (e as Error).message, mappings: [] });
              } finally {
                setTesting(false);
              }
            }}
            className="rounded border border-argus-accent bg-argus-accent/10 px-3 py-1 text-xs text-argus-accent hover:bg-argus-accent/20 disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Run test'}
          </button>
        </div>
        {testResult && <TestResultPanel result={testResult} />}
      </section>

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

function MappingEditor({
  idx,
  mapping,
  onChange,
  onRemove,
  disableRemove,
}: {
  idx: number;
  mapping: PostgresConnectorMapping;
  onChange: (patch: Partial<PostgresConnectorMapping>) => void;
  onRemove: () => void;
  disableRemove: boolean;
}) {
  const fieldsJson = JSON.stringify(mapping.fields, null, 2);
  return (
    <div className="rounded border border-argus-border bg-argus-bg p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs text-argus-muted">mapping #{idx + 1}</span>
        <button
          type="button"
          disabled={disableRemove}
          onClick={onRemove}
          className="text-xs text-argus-danger hover:underline disabled:opacity-30"
        >
          remove
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Source table">
          <input
            value={mapping.table}
            onChange={(e) => onChange({ table: e.target.value })}
            placeholder="deliveries"
            className="w-full rounded border border-argus-border bg-argus-panel px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
          />
        </Field>
        <Field label="Event type">
          <input
            value={mapping.event_type}
            onChange={(e) => onChange({ event_type: e.target.value })}
            placeholder="delivery.completed"
            className="w-full rounded border border-argus-border bg-argus-panel px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
          />
        </Field>
        <Field label="Cursor column">
          <input
            value={mapping.cursor.column}
            onChange={(e) => onChange({ cursor: { ...mapping.cursor, column: e.target.value } })}
            placeholder="updated_at"
            className="w-full rounded border border-argus-border bg-argus-panel px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
          />
        </Field>
        <Field label="Cursor strategy">
          <select
            value={mapping.cursor.strategy}
            onChange={(e) =>
              onChange({ cursor: { ...mapping.cursor, strategy: e.target.value as 'gt' | 'gte' } })
            }
            className="w-full rounded border border-argus-border bg-argus-panel px-3 py-2 text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
          >
            <option value="gt">gt (strict)</option>
            <option value="gte">gte (inclusive — for replays)</option>
          </select>
        </Field>
      </div>
      <Field label="WHERE filter (optional SQL fragment)">
        <input
          value={mapping.when ?? ''}
          onChange={(e) => onChange({ when: e.target.value || undefined })}
          placeholder="status = 'completed' AND delivered_at IS NOT NULL"
          className="w-full rounded border border-argus-border bg-argus-panel px-3 py-2 font-mono text-sm text-slate-100 focus:border-argus-accent focus:outline-none"
        />
      </Field>
      <Field label="Field map (JSON, dest → source column, '*' = all)">
        <textarea
          rows={4}
          value={fieldsJson}
          onChange={(e) => {
            try {
              onChange({ fields: JSON.parse(e.target.value) });
            } catch {
              /* invalid JSON — keep previous, user is mid-edit */
            }
          }}
          className="w-full rounded border border-argus-border bg-argus-panel px-3 py-2 font-mono text-xs text-slate-100 focus:border-argus-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-argus-muted">
          Special: <code className="font-mono">"payload": "*"</code> dumps the whole row into{' '}
          <code className="font-mono">event.payload</code>.
        </p>
      </Field>
    </div>
  );
}

function TestResultPanel({ result }: { result: ConnectorTestResult }) {
  if (!result.ok) {
    return (
      <div className="mt-3 rounded border border-argus-danger/40 bg-argus-danger/5 p-3 text-sm">
        <div className="font-medium text-argus-danger">Connection test failed</div>
        {result.error && (
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-argus-danger">
            {result.error}
          </pre>
        )}
        {result.writable_tables_violation && result.writable_tables_violation.length > 0 && (
          <div className="mt-2 text-xs text-argus-danger">
            User has write privileges (read-only required):{' '}
            <span className="font-mono">{result.writable_tables_violation.join(', ')}</span>
          </div>
        )}
        {result.mappings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {result.mappings.map((m) => (
              <li key={m.table} className={m.reachable ? 'text-argus-ok' : 'text-argus-danger'}>
                {m.reachable ? '✓' : '✗'} <span className="font-mono">{m.table}</span>
                {m.error && <span className="ml-2 text-argus-muted">— {m.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-argus-ok/40 bg-argus-ok/5 p-3 text-sm">
      <div className="font-medium text-argus-ok">Connection OK</div>
      <div className="mt-1 text-xs text-argus-muted">
        Connected as <span className="font-mono">{result.current_user}</span> ·{' '}
        {result.server_version?.split(',')[0]}
      </div>
      {result.mappings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {result.mappings.map((m) => (
            <li key={m.table} className="text-slate-300">
              ✓ <span className="font-mono">{m.table}</span>
              {m.row_count_estimate !== undefined && (
                <span className="ml-2 text-argus-muted">
                  ~{m.row_count_estimate.toLocaleString()} rows
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
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
