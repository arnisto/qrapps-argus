/** Error and notice codes passed through `?error=` / `?ok=` after a redirect. One place for the copy. */
export const ERRORS: Record<string, string> = {
  credentials: 'Wrong email or password.',
  not_confirmed: 'This email is not confirmed yet. Click the link Supabase sent you, or send a new one below.',
  link: 'That sign-in link is invalid or expired.',
  signup: 'Could not create the account. Try another email or a longer password.',
  company_name: 'The company name needs 2 to 80 characters.',
  company_create: 'Could not create the company.',
  meta_not_configured: 'Facebook is not configured on this server yet (META_APP_ID, META_APP_SECRET, META_REDIRECT_URI).',
  meta_state: 'The Facebook sign-in did not come from this browser. Start again from the Sources page.',
  meta_denied: 'Facebook access was not granted.',
  meta_no_code: 'Facebook did not return an authorization code.',
  meta_company: 'You are not a member of that company.',
  meta_save: 'Could not save the Facebook connection.',
  meta_exchange: 'Facebook rejected the sign-in. Check the app id, secret and redirect URI.',
  page_ref: 'Paste a Facebook page link (facebook.com/name) or a numeric page id.',
  ad_terms: 'Ad Library search terms need 2 to 60 characters.',
  source_save: 'Could not save the source (it may already exist).',
  objective_missing: 'That objective no longer exists.',
  objective_title: 'The objective title needs 3 to 140 characters.',
  no_service_key: 'Manual runs need SUPABASE_SERVICE_ROLE_KEY on the server.',
  run_failed: 'The run failed. See the run log below.',
}

export function errorText(code: string | undefined): string | null {
  if (!code) return null
  return ERRORS[code] ?? 'Something went wrong.'
}

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}
