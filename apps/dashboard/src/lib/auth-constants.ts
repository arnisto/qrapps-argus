/**
 * Auth constants shared between middleware (edge runtime), server
 * components, and client components. Lives in its own module because the
 * Next.js edge runtime can't pull from server-only modules.
 */
export const SESSION_COOKIE = 'argus_session';
