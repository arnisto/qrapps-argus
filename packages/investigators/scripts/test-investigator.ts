/**
 * `pnpm investigator:test <id> [--since 7d|--fixtures]`
 *
 * Replays events through an investigator without dispatching alerts. Useful
 * when iterating on a definition or validating a new builtin against history.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@argus/shared';
import { loadInvestigatorFromYaml } from '../src/definition.js';
import { runInvestigator } from '../src/runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const [id, ...rest] = process.argv.slice(2);
  if (!id) {
    console.error('usage: pnpm investigator:test <id> [--since 7d|--fixtures]');
    process.exit(1);
  }
  const useFixtures = rest.includes('--fixtures');

  const def = loadInvestigatorFromYaml(resolve(__dirname, '..', 'templates', `${id}.yaml`));
  logger.info({ id: def.id, name: def.name }, 'investigator.loaded');

  if (useFixtures) {
    const fixturesPath = resolve(__dirname, '..', 'src', '__tests__', 'fixtures', `${id}.json`);
    const events = JSON.parse(readFileSync(fixturesPath, 'utf8'));
    const result = await runInvestigator({
      definition: def,
      trigger: { kind: 'schedule' },
      contextEvents: events,
    });
    console.log(JSON.stringify(result.finding, null, 2));
    return;
  }

  // TODO(v0.1): replay from the live `events` table once the API exposes a
  // historical event-fetch endpoint. Until then, --fixtures is the only mode.
  console.error('--since not implemented in v0.1; use --fixtures');
  process.exit(2);
}

main().catch((err) => {
  logger.error({ err }, 'investigator.test.failed');
  process.exit(1);
});
