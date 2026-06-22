'use client';

import { useState } from 'react';

type Lang = 'curl' | 'python' | 'javascript';

const TABS: { id: Lang; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
];

const KEY_PLACEHOLDER = 'YOUR_ARGUS_KEY';

function snippet(lang: Lang, baseUrl: string): string {
  if (lang === 'curl') {
    return `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {"role": "user", "content": "What is our refund policy?"}
    ]
  }'`;
  }
  if (lang === 'python') {
    return `from openai import OpenAI

client = OpenAI(api_key="${KEY_PLACEHOLDER}", base_url="${baseUrl}")
resp = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "What is our refund policy?"}],
)
print(resp.choices[0].message.content)
print(resp.argus_citations)  # which chunks grounded the answer`;
  }
  return `import OpenAI from "openai";

const client = new OpenAI({ apiKey: "${KEY_PLACEHOLDER}", baseURL: "${baseUrl}" });
const resp = await client.chat.completions.create({
  model: "gemini-2.5-flash",
  messages: [{ role: "user", content: "What is our refund policy?" }],
});
console.log(resp.choices[0].message.content);
console.log((resp as any).argus_citations); // which chunks grounded the answer`;
}

export function CurlPanel({ envSlug, apiBase }: { envSlug: string; apiBase: string }) {
  const [lang, setLang] = useState<Lang>('curl');
  const [copied, setCopied] = useState(false);
  const code = snippet(lang, apiBase);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // user can triple-click the block to select all if clipboard denied
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1">
            Try it from your terminal
          </h2>
          <p className="text-sm text-text-2">
            Mint a key above, paste it where it says{' '}
            <code className="font-mono">{KEY_PLACEHOLDER}</code>, run it. Same{' '}
            grounded answer + citations comes back.
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-inset p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setLang(t.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                lang === t.id
                  ? 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-text'
                  : 'text-text-3 hover:text-text-2'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <pre className="font-mono text-xs bg-inset border border-border rounded-md px-4 py-3 overflow-auto leading-relaxed">
          {code}
        </pre>
        <button
          type="button"
          onClick={onCopy}
          className="absolute top-2 right-2 rounded-md bg-surface border border-border text-2xs font-semibold px-2.5 py-1 text-text-2 hover:text-text hover:bg-bg transition"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      <p className="text-2xs text-text-3 mt-3 font-mono">
        env: <span className="text-text-2">{envSlug}</span> · base:{' '}
        <span className="text-text-2 break-all">{apiBase}</span>
      </p>
    </section>
  );
}
