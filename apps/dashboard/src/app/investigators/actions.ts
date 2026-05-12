'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiPost, apiPut, apiDelete, ApiError } from '@/lib/api';

type ActionResult = { error?: string } | void;

interface InvestigatorBody {
  id?: string;
  name?: string;
  description?: string;
  triggers?: { events: string[]; schedule?: string };
  context?: { lookback: string; related_events: string[]; max_events: number };
  severity_threshold?: 'low' | 'medium' | 'high' | 'critical';
  output?: { alert_channels: string[] };
  agents?: Array<{ agent_id: string; position: number }>;
}

function readBody(fd: FormData, includeId: boolean): InvestigatorBody {
  const eventsCsv = ((fd.get('triggers_events') ?? '') as string).trim();
  const relatedCsv = ((fd.get('context_related_events') ?? '') as string).trim();
  const schedule = ((fd.get('triggers_schedule') ?? '') as string).trim();
  const agentsJson = (fd.get('agents') ?? '[]') as string;
  const agentIds = JSON.parse(agentsJson) as string[];

  const body: InvestigatorBody = {
    name: (fd.get('name') ?? '') as string,
    description: (fd.get('description') ?? '') as string,
    triggers: {
      events: eventsCsv ? eventsCsv.split(',').map((s) => s.trim()).filter(Boolean) : [],
      ...(schedule ? { schedule } : {}),
    },
    context: {
      lookback: ((fd.get('context_lookback') ?? '24h') as string).trim(),
      max_events: Number(fd.get('context_max_events') ?? 400),
      related_events: relatedCsv ? relatedCsv.split(',').map((s) => s.trim()).filter(Boolean) : [],
    },
    severity_threshold: (fd.get('severity_threshold') ?? 'medium') as InvestigatorBody['severity_threshold'],
    output: { alert_channels: fd.getAll('alert_channels').map((v) => v as string) },
    agents: agentIds.map((agent_id, idx) => ({ agent_id, position: idx })),
  };
  if (includeId) {
    body.id = (fd.get('id') ?? '') as string;
  }
  return body;
}

export async function createInvestigator(fd: FormData): Promise<ActionResult> {
  try {
    const body = readBody(fd, true);
    const result = await apiPost<{ investigator_id: string }>('/v1/investigators', body);
    revalidatePath('/investigators');
    redirect(`/investigators/${result.investigator_id}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: parseApiError(e) };
  }
}

export async function updateInvestigator(id: string, fd: FormData): Promise<ActionResult> {
  try {
    const body = readBody(fd, false);
    await apiPut(`/v1/investigators/${id}`, body);
    revalidatePath('/investigators');
    revalidatePath(`/investigators/${id}`);
    return;
  } catch (e) {
    return { error: parseApiError(e) };
  }
}

export async function deleteInvestigator(id: string): Promise<void> {
  // Used directly as a <form action>; signature must be `(fd) => void`.
  await apiDelete(`/v1/investigators/${id}`);
  revalidatePath('/investigators');
  redirect('/investigators');
}

function parseApiError(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const parsed = JSON.parse(e.raw);
      return parsed.message ?? parsed.error ?? e.message;
    } catch {
      return e.message;
    }
  }
  return (e as Error).message;
}

function isRedirectError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'digest' in e &&
    typeof (e as { digest: unknown }).digest === 'string' &&
    (e as { digest: string }).digest.startsWith('NEXT_REDIRECT');
}
