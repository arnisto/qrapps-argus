'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiPost, apiPut, apiDelete, ApiError, type Agent } from '@/lib/api';

type ActionResult = { error?: string } | void;

function readForm(fd: FormData): Record<string, unknown> {
  return {
    name: (fd.get('name') ?? '') as string,
    description: (fd.get('description') ?? '') as string || undefined,
    provider: fd.get('provider') as string,
    model: fd.get('model') as string,
    system_prompt: (fd.get('system_prompt') ?? '') as string,
    user_prompt_template: ((fd.get('user_prompt_template') ?? '') as string) || undefined,
    output_schema_kind: fd.get('output_schema_kind') as string,
  };
}

export async function createAgent(fd: FormData): Promise<ActionResult> {
  try {
    const body = readForm(fd);
    const result = await apiPost<{ agent: Agent }>('/v1/agents', body);
    revalidatePath('/agents');
    redirect(`/agents/${result.agent.id}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: parseApiError(e) };
  }
}

export async function updateAgent(id: string, fd: FormData): Promise<ActionResult> {
  try {
    await apiPut<{ agent: Agent }>(`/v1/agents/${id}`, readForm(fd));
    revalidatePath('/agents');
    revalidatePath(`/agents/${id}`);
    return;
  } catch (e) {
    return { error: parseApiError(e) };
  }
}

export async function deleteAgent(id: string): Promise<void> {
  // Used directly as a <form action>; signature must be `(fd) => void`.
  // On failure the error bubbles to Next's error boundary (e.g. 409 in_use).
  await apiDelete<void>(`/v1/agents/${id}`);
  revalidatePath('/agents');
  redirect('/agents');
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
