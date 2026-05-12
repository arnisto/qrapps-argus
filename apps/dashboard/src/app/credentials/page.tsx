import Link from 'next/link';
import { api, type LlmCredential } from '@/lib/api';
import { Card, CardHeader, CardBody } from '@/components/ds/Card';
import { Chip, AgentBadge } from '@/components/ds/Chip';
import { TestCredentialButton } from '@/components/ds/TestCredentialButton';

export const dynamic = 'force-dynamic';

const PROVIDER_TONE = {
  claude: 'amber',
  openai: 'emerald',
  gemini: 'blue',
  ollama: 'neutral',
  deepseek: 'neutral',
  mock: 'neutral',
} as const;

/**
 * LLM credentials — list view. Each row is a credential (provider + key +
 * default-model). Clicking through opens an edit form; the "Test now" button
 * issues a 1-token completion against the provider with the stored key.
 */
export default async function CredentialsPage() {
  let credentials: LlmCredential[] = [];
  let error: string | null = null;
  try {
    const r = await api<{ credentials: LlmCredential[] }>('/v1/llm-credentials');
    credentials = r.credentials;
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">LLM credentials</h1>
          <p className="mt-1 text-sm text-fg-2">
            API keys for the providers Argus uses. Each credential is named so users can have
            multiple per provider (cost-tracked, team-shared, personal). Agents reference these
            by id; the default for each provider is used when no explicit reference is set.
          </p>
        </div>
        <Link
          href="/credentials/new"
          className="rounded border border-blue/40 bg-blue/10 px-3 py-1.5 text-sm text-blue hover:bg-blue/20"
        >
          + New credential
        </Link>
      </div>

      {error ? (
        <Card>
          <CardBody className="text-rose" style={{ fontSize: 13 }}>
            API unreachable: <code className="mono">{error}</code>
          </CardBody>
        </Card>
      ) : credentials.length === 0 ? (
        <Card>
          <CardBody className="text-center" style={{ padding: 40 }}>
            <h2 className="font-medium" style={{ fontSize: 16 }}>
              No credentials yet
            </h2>
            <p className="text-fg-2 mt-2" style={{ fontSize: 13 }}>
              Argus is falling back to env variables (<code className="mono">ARGUS_*_API_KEY</code>).
              Add a credential to manage keys from the dashboard —{' '}
              <Link className="text-blue hover:underline" href="/credentials/new">
                New credential
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {credentials.map((c) => {
            const tone = PROVIDER_TONE[c.provider];
            return (
              <li
                key={c.id}
                className="rounded border bg-bg-1"
                style={{ borderColor: 'var(--line)', padding: 16 }}
              >
                <div
                  className="grid gap-4 items-start"
                  style={{ gridTemplateColumns: '1fr auto auto' }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AgentBadge tone={tone}>{c.provider.slice(0, 2).toUpperCase()}</AgentBadge>
                      <span className="font-medium" style={{ fontSize: 14 }}>
                        {c.name}
                      </span>
                      <span className="mono text-fg-3" style={{ fontSize: 11 }}>
                        {c.id}
                      </span>
                      <Chip tone={tone} size="sm">
                        {c.provider}
                      </Chip>
                      {c.is_default && (
                        <Chip tone="emerald" size="sm">
                          default
                        </Chip>
                      )}
                      {c.last_test_at && (
                        <Chip tone={c.last_test_ok ? 'emerald' : 'rose'} size="sm">
                          {c.last_test_ok ? '✓ test ok' : '✗ test failed'}
                        </Chip>
                      )}
                    </div>
                    <p className="mt-2 text-fg-2 text-xs">
                      Model: <span className="mono">{c.default_model ?? '(provider default)'}</span>
                      {c.last_test_at && (
                        <>
                          {' '}· Last test:{' '}
                          <span className="mono">{new Date(c.last_test_at).toLocaleString()}</span>
                        </>
                      )}
                    </p>
                    {c.notes && (
                      <p className="mt-1 text-fg-3 text-xs italic">{c.notes}</p>
                    )}
                    {!c.last_test_ok && c.last_test_error && (
                      <p className="mt-1 text-rose mono" style={{ fontSize: 11 }}>
                        {c.last_test_error}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <TestCredentialButton credentialId={c.id} />
                    <Link href={`/credentials/${c.id}`} className="ds-btn sm">
                      Open ›
                    </Link>
                  </div>

                  <span className="shrink-0 self-center text-xs text-fg-3">
                    {new Date(c.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
