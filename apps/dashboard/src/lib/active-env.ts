/**
 * "Active env" resolver for top-level engine pages (/models, /teach,
 * /developer-api, /ask). Reads `?env=<slug>` if present and the user has
 * access; otherwise defaults to the first env the user can reach. Returns
 * null if the user has zero envs — caller renders an empty-state CTA.
 */
import 'server-only';
import { type EnvRow, listEnvsServerSide } from './envs-server';

export interface ActiveEnv {
  current: EnvRow;
  all: EnvRow[];
}

export async function getActiveEnv(
  envQuery: string | string[] | undefined,
): Promise<ActiveEnv | null> {
  const all = await listEnvsServerSide();
  if (all.length === 0) return null;
  const wanted = Array.isArray(envQuery) ? envQuery[0] : envQuery;
  const match = wanted ? all.find((e) => e.slug === wanted) : null;
  return { current: match ?? all[0]!, all };
}
