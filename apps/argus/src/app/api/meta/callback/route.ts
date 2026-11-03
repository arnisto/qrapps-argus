import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { encrypt, toHex } from '@/lib/crypto'
import { GraphClient, META_SCOPES, exchangeCode, listPages } from '@/lib/meta/graph'
import { META_STATE_COOKIE, checkState } from '@/lib/meta/state'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const checked = checkState(req.cookies.get(META_STATE_COOKIE)?.value, params.get('state'))
  if (!checked.ok) return NextResponse.redirect(new URL('/companies?error=meta_state', req.url))
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/c/${checked.companySlug}/sources?${q}`, req.url))
    res.cookies.delete(META_STATE_COOKIE)
    return res
  }

  if (params.get('error')) return back('error=meta_denied')
  const code = params.get('code')
  if (!code) return back('error=meta_no_code')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))
  const { data: company } = await supabase.from('companies').select('id, slug').eq('slug', checked.companySlug).maybeSingle()
  if (!company) return back('error=meta_company')

  try {
    const { token, expiresAt } = await exchangeCode(code)
    const graph = new GraphClient(token)
    const me = await graph.get<{ id: string; name?: string }>('me', { fields: 'id,name' })
    const { ct, iv } = encrypt(token)
    const { data: connection, error } = await supabase
      .from('connections')
      .upsert(
        {
          company_id: company.id,
          provider: 'meta',
          external_user_id: me.id,
          external_name: me.name ?? null,
          token_ct: toHex(ct),
          token_iv: toHex(iv),
          scopes: META_SCOPES,
          expires_at: expiresAt?.toISOString() ?? null,
          status: 'active',
          created_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id,provider,external_user_id' },
      )
      .select('id')
      .single()
    if (error || !connection) return back('error=meta_save')

    const pages = await listPages(graph)
    if (pages.length) {
      await supabase.from('sources').upsert(
        pages.map((p) => ({
          company_id: company.id,
          connection_id: connection.id,
          kind: 'own_page',
          external_id: p.id,
          name: p.name,
          config: { category: p.category ?? null, fan_count: p.fan_count ?? null },
          status: 'active',
        })),
        { onConflict: 'company_id,kind,external_id' },
      )
    }
    return back(`connected=${pages.length}`)
  } catch (e) {
    console.error('[meta callback]', (e as Error).message)
    return back('error=meta_exchange')
  }
}
