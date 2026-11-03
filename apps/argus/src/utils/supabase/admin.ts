import { createClient } from '@supabase/supabase-js'
import { requireEnv } from '@/lib/env'

/**
 * Service-role client. Bypasses RLS. Only the job runner (`/api/jobs/run`) and the Meta OAuth callback may
 * use it, and only in server code. Never import from a component or a client file.
 */
export function createAdminClient() {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
