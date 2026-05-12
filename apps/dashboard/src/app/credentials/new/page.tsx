import Link from 'next/link';
import { CredentialForm } from '@/components/CredentialForm';
import { createCredential } from '../actions';

export default function NewCredentialPage() {
  return (
    <div className="max-w-3xl px-4 py-6">
      <Link href="/credentials" className="text-blue hover:underline" style={{ fontSize: 13 }}>
        ← Back to credentials
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">New LLM credential</h1>
      <p className="mt-1 text-fg-2" style={{ fontSize: 13 }}>
        Add an API key for Claude, OpenAI, or Gemini. The key is stored in the DB (redacted on
        read) — no editing <code className="mono">.env</code> needed.
      </p>
      <div
        className="mt-6 rounded p-6"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--line)' }}
      >
        <CredentialForm action={createCredential} submitLabel="Create credential" />
      </div>
    </div>
  );
}
