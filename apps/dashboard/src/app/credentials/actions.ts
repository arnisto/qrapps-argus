'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiPost, apiPut, apiDelete, ApiError, type ProviderId } from '@/lib/api';

type ActionResult = { error?: string } | void;

function readBody(fd: FormData): {
  name: string;
  provider: ProviderId;
  api_key: string;
  default_model?: string;
  is_default?: boolean;
  notes?: string;
} {
  const model = ((fd.get('default_model') ?? '') as string).trim();
  const notes = ((fd.get('notes') ?? '') as string).trim();
  return {
    name: ((fd.get('name') ?? '') as string).trim(),
    provider: (fd.get('provider') ?? 'gemini') as ProviderId,
    api_key: ((fd.get('api_key') ?? '') as string).trim(),
    ...(model ? { default_model: model } : {}),
    is_default: fd.get('is_default') === 'on',
    ...(notes ? { notes } : {}),
  };
}

export async function createCredential(fd: FormData): Promise<ActionResult> {
  try {
    const body = readBody(fd);
    if (!body.api_key) return { error: 'API key is required.' };
    const r = await apiPost<{ credential_id: string }>('/v1/llm-credentials', body);
    revalidatePath('/credentials');
    redirect(`/credentials/${r.credential_id}`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    return { error: parseApiError(e) };
  }
}

export async function updateCredential(id: string, fd: FormData): Promise<ActionResult> {
  try {
    const body = readBody(fd);
    // Only forward api_key if user actually changed it from the placeholder.
    const payload: Record<string, unknown> = {
      name: body.name,
      default_model: body.default_model,
      is_default: body.is_default,
      notes: body.notes,
    };
    if (body.api_key && body.api_key !== '__REDACTED__') {
      payload.api_key = body.api_key;
    }
    await apiPut(`/v1/llm-credentials/${id}`, payload);
    revalidatePath('/credentials');
    revalidatePath(`/credentials/${id}`);
    return;
  } catch (e) {
    return { error: parseApiError(e) };
  }
}

export async function deleteCredential(id: string): Promise<void> {
  await apiDelete(`/v1/llm-credentials/${id}`);
  revalidatePath('/credentials');
  redirect('/credentials');
}

function parseApiError(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const parsed = JSON.parse(e.raw) as { message?: string; error?: string };
      return parsed.message ?? parsed.error ?? e.message;
    } catch {
      return e.message;
    }
  }
  return (e as Error).message;
}

function isRedirect(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'digest' in e &&
    typeof (e as { digest: unknown }).digest === 'string' &&
    (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
