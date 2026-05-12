import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiPost, ApiError } from '@/lib/api';

/**
 * BFF for "Crawl schema now". Pure proxy; same pattern as the test BFFs.
 *
 * Forward the `?describe=` querystring so the dashboard can let users opt out
 * of the LLM description (useful when Gemini is rate-limited).
 */
export async function POST(req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  const id = ctx.params.id;
  const describe = new URL(req.url).searchParams.get('describe');
  const path = `/v1/connectors/${id}/crawl${describe ? `?describe=${describe}` : ''}`;
  try {
    const result = await apiPost(path);
    revalidatePath(`/connectors/${id}`);
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
