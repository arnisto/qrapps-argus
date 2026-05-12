import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiPost, ApiError } from '@/lib/api';

interface TestResult {
  ok: boolean;
  model?: string;
  error?: string;
}

/**
 * BFF for "Test now" on the credentials page — pure proxy to the API's
 * `/v1/llm-credentials/:id/test`. Same pattern as the connector test BFF;
 * exists to avoid Next.js server-action ID staleness in dev mode.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const id = ctx.params.id;
  try {
    const result = await apiPost<TestResult>(`/v1/llm-credentials/${id}/test`);
    revalidatePath('/credentials');
    revalidatePath(`/credentials/${id}`);
    return NextResponse.json(result);
  } catch (e) {
    const message =
      e instanceof ApiError ? safeParseApiError(e.raw) || e.message : (e as Error).message;
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
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
