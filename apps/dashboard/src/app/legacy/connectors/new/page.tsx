import Link from 'next/link';
import { ConnectorForm } from '@/components/ConnectorForm';
import { createConnector, testConnector } from '../actions';

export default function NewConnectorPage() {
  return (
    <div className="max-w-4xl">
      <Link href="/connectors" className="text-sm text-argus-accent hover:underline">
        ← Back to connectors
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">New connector</h1>
      <p className="mt-1 text-sm text-argus-muted">
        Point Argus at a Postgres source. The user must be <strong>read-only</strong> — the
        connector refuses to start otherwise. Test the connection before saving.
      </p>
      <div className="mt-6">
        <ConnectorForm
          action={createConnector}
          testAction={testConnector}
          submitLabel="Create connector"
        />
      </div>
    </div>
  );
}
