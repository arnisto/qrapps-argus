import Link from 'next/link';
import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { getMeServerSide } from '@/lib/auth-server';
import { listEnvsServerSide } from '@/lib/envs-server';

export const dynamic = 'force-dynamic';

interface KpiSpec {
  value: string | number;
  label: string;
  sub: string;
  href: string;
  /** Mark the one tile that should headline the page — gets the only accent treatment. */
  headline?: boolean;
}

export default async function DashboardPage() {
  const me = (await getMeServerSide())!;
  const envs = await listEnvsServerSide();
  const firstEnv = envs[0];
  const envQs = firstEnv ? `?env=${encodeURIComponent(firstEnv.slug)}` : '';

  const totalProviders = envs.reduce((sum, e) => sum + e.providers, 0);
  const totalSources = envs.reduce((sum, e) => sum + e.sources, 0);
  const totalChunks = envs.reduce((sum, e) => sum + e.chunks, 0);
  const totalRequests = envs.reduce((sum, e) => sum + e.requests, 0);
  const totalCost = envs.reduce((sum, e) => sum + Number(e.cost_usd || 0), 0);
  const totalKeys = envs.reduce((sum, e) => sum + e.api_keys, 0);

  // KPIs read calm — one numerical headline (Requests) is the only accent on
  // the page; everything else is tone-on-tone so the eye knows where to land.
  const kpis: KpiSpec[] = [
    { value: envs.length, label: 'Environments', sub: 'live across your orgs', href: '/environments' },
    { value: totalProviders, label: 'Models connected', sub: 'across all envs', href: `/models${envQs}` },
    { value: `${totalSources} src`, label: 'Knowledge', sub: `${totalChunks.toLocaleString()} chunks indexed`, href: `/teach${envQs}` },
    { value: totalRequests, label: 'Requests', sub: 'served via /v1/chat', href: '/audit', headline: true },
    { value: `$${totalCost.toFixed(4)}`, label: 'Spend', sub: 'cumulative cost', href: '/audit' },
    { value: totalKeys, label: 'API keys', sub: 'minted, active', href: `/developer-api${envQs}` },
  ];

  // The buyer-demo next-step checklist — derived from real counts so it
  // accurately reflects "what to do next" and ticks itself off as the buyer
  // works through the flow.
  const steps = [
    {
      done: envs.length > 0,
      label: 'Create your first environment',
      href: '/environments/new',
      hint: 'One isolated tenant per business / workspace / customer.',
    },
    {
      done: totalProviders > 0,
      label: 'Connect a model',
      href: `/models${envQs}`,
      hint: 'Gemini for embeddings + chat. Add Groq for ~10× faster Llama replies.',
    },
    {
      done: totalSources > 0,
      label: 'Teach Argus something',
      href: `/teach${envQs}`,
      hint: 'Upload a markdown file or paste a Q&A pair — Argus grounds replies on it.',
    },
    {
      done: totalRequests > 0,
      label: 'Ask Argus a question',
      href: `/ask${envQs}`,
      hint: 'Watch the answer cite the chunks it grounded on. That citation is the moat.',
    },
    {
      done: totalKeys > 0,
      label: 'Mint a developer key and call /v1/chat',
      href: `/developer-api${envQs}`,
      hint: 'OpenAI-compatible. Drop into any client by swapping baseURL.',
    },
  ];

  return (
    <AppLayout redirectTarget="/dashboard">
      <PageShell
        title={`Good to see you, ${me.user.name ?? me.user.email.split('@')[0]}`}
        subtitle="Your knowledge layer at a glance. Click any tile to drill in."
        maxWidth="1100px"
      >
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
          {kpis.map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className={[
                'rounded-2xl border bg-surface p-5 transition group',
                k.headline
                  ? 'border-accent/30 hover:border-accent shadow-card'
                  : 'border-border hover:bg-surface-2',
              ].join(' ')}
            >
              <div
                className={[
                  'font-mono text-3xl font-bold tracking-tight',
                  k.headline ? 'text-accent' : 'text-text',
                ].join(' ')}
              >
                {k.value}
              </div>
              <div className="text-sm font-semibold text-text mt-3">{k.label}</div>
              <div className="text-xs text-text-3 mt-0.5">{k.sub}</div>
            </Link>
          ))}
        </div>

        <section className="mt-6 rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-2 border-b border-border pb-3 mb-4">
            Next steps
          </h2>
          <ul className="space-y-2.5">
            {steps.map((s) => (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className="group flex items-start gap-3 -mx-2 px-2 py-1.5 rounded-md hover:bg-surface-2 transition"
                >
                  <span
                    aria-hidden
                    className={[
                      'flex-none w-5 h-5 rounded-full border flex items-center justify-center text-2xs font-bold mt-0.5',
                      s.done
                        ? 'bg-green text-white border-green'
                        : 'bg-surface text-text-3 border-border group-hover:border-accent group-hover:text-accent',
                    ].join(' ')}
                  >
                    {s.done ? '✓' : ''}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={[
                        'text-sm font-medium',
                        s.done ? 'text-text-2 line-through decoration-text-3/40' : 'text-text',
                      ].join(' ')}
                    >
                      {s.label}
                    </div>
                    <div className="text-xs text-text-3 mt-0.5">{s.hint}</div>
                  </div>
                  <span className="flex-none text-text-3 text-sm group-hover:text-accent transition">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </PageShell>
    </AppLayout>
  );
}
