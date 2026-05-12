import { logger, loadConfig } from '@argus/shared';
import { startEventsProcessWorker } from './workers/events-process.js';
import { startInvestigatorWorker } from './workers/investigator-run.js';
import { startAlertWorker } from './workers/alert-dispatch.js';
import { startConnectorPoller } from './workers/connector-poll.js';

async function main(): Promise<void> {
  loadConfig(); // fail fast on missing env

  const stoppers = await Promise.all([
    startEventsProcessWorker(),
    startInvestigatorWorker(),
    startAlertWorker(),
    startConnectorPoller(),
  ]);

  logger.info('workers.started');

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      logger.info({ sig }, 'workers.shutting_down');
      await Promise.allSettled(stoppers.map((s) => s()));
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.error({ err }, 'workers.failed_to_start');
  process.exit(1);
});
