'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  apiPost,
  apiPut,
  apiDelete,
  ApiError,
  type ConnectorTestResult,
  type PostgresConnectorConfig,
} from '@/lib/api';

type ActionResult = { error?: string } | void;

interface ConnectorBody {
  id?: string;
  type: 'postgres';
  name?: string;
  enabled: boolean;
  config: PostgresConnectorConfig;
}

function readBody(fd: FormData, includeId: boolean): ConnectorBody {
  const configJson = (fd.get('config_json') ?? '{}') as string;
  const config = JSON.parse(configJson) as PostgresConnectorConfig;
  const body: ConnectorBody = {
    type: 'postgres',
    name: (fd.get('name') ?? '') as string,
    enabled: fd.get('enabled') === 'on',
    config,
  };
  if (includeId) {
    const id = ((fd.get('id') ?? '') as string).trim();
    if (id) body.id = id;
  }
  return body;
}

export async function createConnector(fd: FormData): Promise<ActionResult> {
  try {
    const body = readBody(fd, true);
    const result = await apiPost<{ connector_id: string }>('/v1/connectors', body);
    revalidatePath('/connectors');
    redirect(`/connectors/${result.connector_id}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: parseApiError(e) };
  }
}

export async function updateConnector(id: string, fd: FormData): Promise<ActionResult> {
  try {
    // PUT doesn't take id/type from the form — they're immutable.
    const body = readBody(fd, false);
    await apiPut(`/v1/connectors/${id}`, {
      name: body.name,
      enabled: body.enabled,
      config: body.config,
    });
    revalidatePath('/connectors');
    revalidatePath(`/connectors/${id}`);
    return;
  } catch (e) {
    return { error: parseApiError(e) };
  }
}

export async function deleteConnector(id: string): Promise<void> {
  await apiDelete(`/v1/connectors/${id}`);
  revalidatePath('/connectors');
  redirect('/connectors');
}

export async function testConnector(
  config: PostgresConnectorConfig,
  connectorId?: string,
): Promise<ConnectorTestResult> {
  try {
    // When editing a saved connector AND the password field is the redacted
    // placeholder, hand the server the id so it can splice in the stored
    // password. Without this, "Run test" after editing any non-secret field
    // fails with "password authentication failed" — because the form sends
    // `__REDACTED__` literally.
    return await apiPost<ConnectorTestResult>('/v1/connectors/test', {
      type: 'postgres',
      config,
      ...(connectorId ? { connector_id: connectorId } : {}),
    });
  } catch (e) {
    return { ok: false, error: parseApiError(e), mappings: [] };
  }
}

/**
 * Test a saved connector by id — uses the stored config server-side, persists
 * the outcome to `connectors.last_test_*` columns, and revalidates the
 * dashboard surfaces that show it.
 */
export async function testSavedConnector(id: string): Promise<ConnectorTestResult> {
  try {
    const result = await apiPost<ConnectorTestResult>(`/v1/connectors/${id}/test`);
    revalidatePath('/connectors');
    revalidatePath(`/connectors/${id}`);
    revalidatePath('/health');
    return result;
  } catch (e) {
    return { ok: false, error: parseApiError(e), mappings: [] };
  }
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
