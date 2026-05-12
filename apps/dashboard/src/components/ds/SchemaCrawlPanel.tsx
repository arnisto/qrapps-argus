'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ConnectorSchemaRow } from '@/lib/api';
import { Card, CardHeader, CardBody } from './Card';
import { Chip } from './Chip';

interface Props {
  connectorId: string;
  schema: ConnectorSchemaRow | null;
}

/**
 * Schema panel on the connector detail page. Renders the stored crawl (if any)
 * + the LLM description. Two action buttons:
 *   - "Crawl now (with description)" — full crawl + LLM narrative
 *   - "Crawl now (skip description)" — for when LLM credentials are rate-limited
 *
 * After a successful crawl we trigger `router.refresh()` so the surrounding
 * server component re-renders with the new schema_json.
 */
export function SchemaCrawlPanel({ connectorId, schema }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<'idle' | 'with-llm' | 'no-llm'>('idle');
  const [resultMessage, setResultMessage] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(
    null,
  );

  async function crawl(describe: boolean) {
    setPending(describe ? 'with-llm' : 'no-llm');
    setResultMessage(null);
    try {
      const res = await fetch(
        `/api/connectors/${connectorId}/crawl?describe=${describe ? 'true' : 'false'}`,
        { method: 'POST' },
      );
      const data = (await res.json()) as
        | { ok: true; tables_crawled: number; mapped_tables: string[]; description: string | null }
        | { ok: false; error: string };
      if (data.ok) {
        setResultMessage({
          tone: 'ok',
          text: `Crawled ${data.tables_crawled} tables${describe ? ' · description generated' : ''}`,
        });
        router.refresh();
      } else {
        setResultMessage({ tone: 'fail', text: data.error.slice(0, 200) });
      }
    } catch (err) {
      setResultMessage({
        tone: 'fail',
        text: err instanceof Error ? err.message : 'crawl failed',
      });
    } finally {
      setPending('idle');
    }
  }

  const tablesWithCols = (schema?.schema_json.tables ?? []).filter((t) => t.columns.length > 0);
  const otherTables = (schema?.schema_json.tables ?? []).filter((t) => t.columns.length === 0);

  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">Schema</span>
        {schema?.crawled_at && (
          <span className="mono text-fg-3" style={{ fontSize: 11 }}>
            crawled {new Date(schema.crawled_at).toLocaleString()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={pending !== 'idle'}
            onClick={() => void crawl(true)}
            className={`ds-btn sm ${pending === 'with-llm' ? 'primary' : ''}`}
          >
            {pending === 'with-llm' ? '⟳ Crawling + describing…' : 'Crawl + describe'}
          </button>
          <button
            type="button"
            disabled={pending !== 'idle'}
            onClick={() => void crawl(false)}
            className={`ds-btn sm ${pending === 'no-llm' ? 'primary' : ''}`}
            title="Crawl the schema only, without calling the LLM for a description"
          >
            {pending === 'no-llm' ? '⟳ Crawling…' : 'Crawl only'}
          </button>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {resultMessage && (
          <div
            className="rounded p-2 text-xs"
            style={{
              border: `1px solid color-mix(in oklch, var(--${resultMessage.tone === 'ok' ? 'emerald' : 'rose'}) 40%, var(--line))`,
              background: `color-mix(in oklch, var(--${resultMessage.tone === 'ok' ? 'emerald' : 'rose'}) 8%, var(--bg-1))`,
              color: `var(--${resultMessage.tone === 'ok' ? 'emerald' : 'rose'})`,
            }}
          >
            {resultMessage.text}
          </div>
        )}

        {!schema ? (
          <p className="text-fg-2" style={{ fontSize: 13 }}>
            This connector hasn&apos;t been crawled yet. Click <strong>Crawl + describe</strong> to
            introspect the source schema and have Argus write a description of what it tracks.
          </p>
        ) : (
          <>
            {schema.crawl_error && (
              <div
                className="rounded p-2 text-xs"
                style={{
                  border: '1px solid color-mix(in oklch, var(--rose) 40%, var(--line))',
                  background: 'color-mix(in oklch, var(--rose) 8%, var(--bg-1))',
                  color: 'var(--rose)',
                }}
              >
                Last crawl failed: <span className="mono">{schema.crawl_error}</span>
              </div>
            )}

            {schema.description && (
              <div>
                <div className="uppercase-mini text-fg-3 mb-1 flex items-center gap-2">
                  <span>LLM description</span>
                  {schema.description_at && (
                    <span className="mono">
                      · {new Date(schema.description_at).toLocaleString()}
                    </span>
                  )}
                  {schema.description_credential_id && (
                    <Chip tone="blue" size="sm">
                      {schema.description_credential_id}
                    </Chip>
                  )}
                </div>
                <p
                  className="text-fg-1"
                  style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}
                >
                  {schema.description}
                </p>
              </div>
            )}

            <div>
              <div className="uppercase-mini text-fg-3 mb-2">
                Tables crawled — {schema.schema_json.tables.length} total
                {tablesWithCols.length > 0 && (
                  <span> · {tablesWithCols.length} with full metadata</span>
                )}
              </div>

              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {tablesWithCols.map((t) => (
                  <TableCard
                    key={t.table}
                    table={t}
                    isMapped={schema.schema_json.mapped_tables.includes(t.table)}
                  />
                ))}
              </div>

              {otherTables.length > 0 && (
                <details className="mt-3">
                  <summary
                    className="cursor-pointer text-fg-3"
                    style={{ fontSize: 12 }}
                  >
                    + {otherTables.length} tables without column metadata{' '}
                    <span className="text-fg-3 italic">
                      (the connector&apos;s DB role has no SELECT on these)
                    </span>
                  </summary>
                  <ul className="mt-2 grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', fontSize: 11 }}>
                    {otherTables.map((t) => (
                      <li key={t.table} className="mono text-fg-3 truncate" title={t.table}>
                        {t.table} <span className="text-fg-3">— rows≈{t.row_count_estimate.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function TableCard({
  table,
  isMapped,
}: {
  table: ConnectorSchemaRow['schema_json']['tables'][number];
  isMapped: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded"
      style={{ border: '1px solid var(--line)', background: 'var(--bg-2)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-3"
      >
        <span className="mono truncate" style={{ fontSize: 12 }}>
          {table.table}
        </span>
        {isMapped && (
          <Chip tone="blue" size="sm">
            mapped
          </Chip>
        )}
        <span className="ml-auto mono text-fg-3" style={{ fontSize: 10.5 }}>
          {table.columns.length} cols · rows≈{table.row_count_estimate.toLocaleString()}
        </span>
        <span className="text-fg-3">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--line)' }}>
          {table.primary_key.length > 0 && (
            <p className="mt-2 mono text-fg-3" style={{ fontSize: 11 }}>
              pk: {table.primary_key.join(', ')}
            </p>
          )}
          <ul
            className="mt-2 grid gap-x-4"
            style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', fontSize: 11 }}
          >
            {table.columns.map((c) => (
              <li key={c.name} className="mono">
                <span className="text-fg-1">{c.name}</span>{' '}
                <span className="text-fg-3">
                  {c.data_type}
                  {c.nullable ? '?' : ''}
                </span>
              </li>
            ))}
          </ul>
          {table.foreign_keys.length > 0 && (
            <div className="mt-2">
              <div className="uppercase-mini text-fg-3 mb-1">Foreign keys</div>
              {table.foreign_keys.map((f, i) => (
                <div key={i} className="mono text-fg-2" style={{ fontSize: 11 }}>
                  {f.column} → {f.references_table}.{f.references_column}
                </div>
              ))}
            </div>
          )}
          {table.samples.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-fg-3" style={{ fontSize: 11 }}>
                {table.samples.length} sample row{table.samples.length === 1 ? '' : 's'}
              </summary>
              <pre
                className="ds-code"
                style={{ marginTop: 4, fontSize: 10.5, maxHeight: 240 }}
              >
                {JSON.stringify(table.samples, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
