import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, type LlmCredentialDetail } from '@/lib/api';
import { CredentialForm } from '@/components/CredentialForm';
import { updateCredential, deleteCredential } from '../actions';
import { TestCredentialButton } from '@/components/ds/TestCredentialButton';
import { Card, CardHeader, CardBody } from '@/components/ds/Card';
import { Chip } from '@/components/ds/Chip';

export const dynamic = 'force-dynamic';

export default async function EditCredentialPage({ params }: { params: { id: string } }) {
  let cred: LlmCredentialDetail;
  try {
    const r = await api<{ credential: LlmCredentialDetail }>(`/v1/llm-credentials/${params.id}`);
    cred = r.credential;
  } catch {
    return notFound();
  }

  return (
    <div className="max-w-3xl px-4 py-6">
      <Link href="/credentials" className="text-blue hover:underline" style={{ fontSize: 13 }}>
        ← Back to credentials
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{cred.name}</h1>
      <p className="mt-1 mono text-fg-3" style={{ fontSize: 11 }}>
        {cred.id} · {cred.provider}
        {cred.is_default && ' · default'}
      </p>

      <Card className="mt-4">
        <CardHeader>
          <span className="font-semibold">Health</span>
          <div className="ml-auto">
            <TestCredentialButton credentialId={cred.id} />
          </div>
        </CardHeader>
        <CardBody className="text-sm flex flex-col gap-1">
          {cred.last_test_at ? (
            <>
              <div>
                {cred.last_test_ok ? '✓ Passed' : '✗ Failed'}{' '}
                <span className="mono text-fg-3">
                  at {new Date(cred.last_test_at).toLocaleString()}
                </span>
              </div>
              {!cred.last_test_ok && cred.last_test_error && (
                <div className="text-rose mono" style={{ fontSize: 11 }}>
                  {cred.last_test_error}
                </div>
              )}
              {cred.last_test_ok && (
                <Chip tone="emerald" size="sm">
                  last test ok
                </Chip>
              )}
            </>
          ) : (
            <span className="text-fg-3 italic">
              Never tested — click <strong>Test key</strong> above to verify.
            </span>
          )}
        </CardBody>
      </Card>

      <div
        className="mt-6 rounded p-6"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--line)' }}
      >
        <CredentialForm
          initial={cred}
          action={updateCredential.bind(null, cred.id)}
          submitLabel="Save changes"
        />
      </div>

      <form
        action={deleteCredential.bind(null, cred.id)}
        className="mt-6 rounded p-4"
        style={{
          border: '1px solid color-mix(in oklch, var(--rose) 40%, var(--line))',
          background: 'var(--bg-1)',
        }}
      >
        <p className="text-fg-1" style={{ fontSize: 13 }}>
          Delete this credential. Refuses (409) if any agent still references it — detach those
          agents first.
        </p>
        <button
          type="submit"
          className="ds-btn danger sm"
          style={{ marginTop: 10 }}
        >
          Delete credential
        </button>
      </form>
    </div>
  );
}
