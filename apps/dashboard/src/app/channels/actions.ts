'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiPost, apiPut, apiDelete, ApiError, type AlertChannelType } from '@/lib/api';

type ActionResult = { error?: string } | void;

interface ChannelBody {
  id?: string;
  type: AlertChannelType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

function readBody(fd: FormData): ChannelBody {
  const type = (fd.get('type') ?? 'slack') as AlertChannelType;
  const config: Record<string, unknown> = {};

  // Per-type extraction. Empty strings → omit.
  if (type === 'slack' || type === 'discord') {
    const url = (fd.get('webhook_url') as string)?.trim();
    const envName = (fd.get('webhook_url_env') as string)?.trim();
    if (url) config.webhook_url = url;
    if (envName) config.webhook_url_env = envName;
  } else if (type === 'webhook') {
    const url = (fd.get('url') as string)?.trim();
    const secretEnv = (fd.get('secret_env') as string)?.trim();
    if (url) config.url = url;
    if (secretEnv) config.secret_env = secretEnv;
  }

  const minSev = (fd.get('min_severity') as string)?.trim();
  if (minSev) config.min_severity = minSev;

  const id = ((fd.get('id') ?? '') as string).trim();
  return {
    ...(id ? { id } : {}),
    type,
    name: (fd.get('name') ?? '') as string,
    enabled: fd.get('enabled') === 'on',
    config,
  };
}

export async function createChannel(fd: FormData): Promise<ActionResult> {
  try {
    const body = readBody(fd);
    const result = await apiPost<{ channel_id: string }>('/v1/alert-channels', body);
    revalidatePath('/channels');
    redirect(`/channels/${result.channel_id}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: parseApiError(e) };
  }
}

export async function updateChannel(id: string, fd: FormData): Promise<ActionResult> {
  try {
    const body = readBody(fd);
    await apiPut(`/v1/alert-channels/${id}`, {
      name: body.name,
      enabled: body.enabled,
      config: body.config,
    });
    revalidatePath('/channels');
    revalidatePath(`/channels/${id}`);
    return;
  } catch (e) {
    return { error: parseApiError(e) };
  }
}

export async function deleteChannel(id: string): Promise<void> {
  await apiDelete(`/v1/alert-channels/${id}`);
  revalidatePath('/channels');
  redirect('/channels');
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
  return (
    typeof e === 'object' &&
    e !== null &&
    'digest' in e &&
    typeof (e as { digest: unknown }).digest === 'string' &&
    (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
