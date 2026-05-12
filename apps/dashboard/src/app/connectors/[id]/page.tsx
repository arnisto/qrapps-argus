import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, type ConnectorDetail, type ConnectorSchemaRow } from '@/lib/api';
import { ConnectorForm } from '@/components/ConnectorForm';
import { updateConnector, deleteConnector, testConnector } from '../actions';
import { TestNowButton } from '@/components/ds/TestNowButton';
import { Card, CardHeader, CardBody } from '@/components/ds/Card';
import { Chip } from '@/components/ds/Chip';
import { SchemaCrawlPanel } from '@/components/ds/SchemaCrawlPanel';

export const dynamic = 'force-dynamic';

export default async function EditConnectorPage({ params }: { params: { id: string } }) {
  let connector: ConnectorDetail;
  try {
    const res = await api<{ connector: ConnectorDetail }>(`/v1/connectors/${params.id}`);
    connector = res.connector;
  } catch {
    return notFound();
  }

  // Load the stored schema if there is one. 404 → no crawl yet; we render the
  // empty-state CTA inside SchemaCrawlPanel.
  let schemaRow: ConnectorSchemaRow | null = null;
  try {
    schemaRow = await api<ConnectorSchemaRow>(`/v1/connectors/${params.id}/schema`);
  } catch {
    /* not crawled yet */
  }

  return (
    <div className="max-w-4xl">
      <Link href="/connectors" className="text-sm text-blue hover:underline">
        ← Back to connectors
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{connector.name}</h1>
      <p className="mt-1 mono text-fg-3" style={{ fontSize: 11 }}>
        {connector.id} · {connector.type}
      </p>

      {/* health row — sync + manual test results, side by side */}
      <Card className="mt-4">
        <CardHeader>
          <span className="font-semibold">Health</span>
          <div className="ml-auto">
            <TestNowButton connectorId={connector.id} size="md" />
          </div>
        </CardHeader>
        <CardBody className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="flex flex-col gap-1">
            <span className="uppercase-mini text-fg-3">Polling loop</span>
            <span style={{ fontSize: 12.5 }}>
              {connector.last_sync_at ? (
                <>
                  Last sync{' '}
                  <span className="mono">
                    {new Date(connector.last_sync_at).toLocaleString()}
                  </span>
                </>
              ) : (
                <span className="text-fg-3 italic">No sync yet</span>
              )}
            </span>
            {connector.last_error && (
              <span className="text-rose mono" style={{ fontSize: 11 }}>
                {connector.last_error}
              </span>
            )}
            {!connector.last_error && connector.last_sync_at && (
              <Chip tone="emerald" size="sm">
                healthy
              </Chip>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="uppercase-mini text-fg-3">Manual test</span>
            {connector.last_test_at ? (
              <>
                <span style={{ fontSize: 12.5 }}>
                  {connector.last_test_ok ? '✓ passed' : '✗ failed'} ·{' '}
                  <span className="mono text-fg-2">
                    {new Date(connector.last_test_at).toLocaleString()}
                  </span>
                </span>
                {!connector.last_test_ok && connector.last_test_error && (
                  <span className="text-rose mono" style={{ fontSize: 11 }}>
                    {connector.last_test_error}
                  </span>
                )}
                {connector.last_test_ok && (
                  <Chip tone="emerald" size="sm">
                    last test ok
                  </Chip>
                )}
              </>
            ) : (
              <span className="text-fg-3 italic" style={{ fontSize: 12.5 }}>
                Never tested — click <strong>Test now</strong> to verify.
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      <div className="mt-4">
        <SchemaCrawlPanel connectorId={connector.id} schema={schemaRow} />
      </div>

      <div className="mt-6">
        <ConnectorForm
          initial={connector}
          action={updateConnector.bind(null, connector.id)}
          testAction={testConnector}
          submitLabel="Save changes"
        />
      </div>

      <form
        action={deleteConnector.bind(null, connector.id)}
        className="mt-6 rounded border border-argus-danger/40 bg-argus-panel p-4"
      >
        <p className="text-sm text-slate-300">
          Delete this connector. Cursor state is dropped (CASCADE on{' '}
          <span className="font-mono">connector_cursors</span>); events already ingested stay.
        </p>
        <button
          type="submit"
          className="mt-3 rounded border border-argus-danger px-3 py-1.5 text-sm text-argus-danger hover:bg-argus-danger/10"
        >
          Delete connector
        </button>
      </form>
    </div>
  );
}
