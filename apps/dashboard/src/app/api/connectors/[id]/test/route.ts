import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiPost, ApiError, type ConnectorTestResult } from '@/lib/api';

/**
 * Dashboard-side BFF endpoint for "Test now". Exists to bypass Next.js server
 * actions, which proved fragile in dev mode (stale action IDs after HMR caused
 * clicks to silently no-op). A regular route handler is a plain HTTP endpoint
 * the browser can hit with `fetch` — no client/server hash matching required.
 *
 * Auth: this endpoint inherits the dashboard's bearer-token because it calls
 * the Argus API server-side via `apiPost`, which has access to
 * `ARGUS_INGEST_TOKEN`. The browser never sees the token.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const id = ctx.params.id;
  try {
    const result = await apiPost<ConnectorTestResult>(`/v1/connectors/${id}/test`);
    revalidatePath('/connectors');
    revalidatePath(`/connectors/${id}`);
    revalidatePath('/health');
    return NextResponse.json(result);
  } catch (e) {
    const message =
      e instanceof ApiError
        ? safeParseApiError(e.raw) || e.message
        : (e as Error).message;
    return NextResponse.json(
      { ok: false, error: message, mappings: [] } satisfies ConnectorTestResult,
      { status: 200 }, // 200 by design — the *test* failed, the route succeeded.
    );
  }
}

function safeParseApiError(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? null;
  } catch {
    return null;
  }
}
