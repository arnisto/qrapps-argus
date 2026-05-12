import { logger, loadConfig } from '@argus/shared';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer();

  try {
    await app.listen({ port: config.apiPort, host: '0.0.0.0' });
    logger.info({ port: config.apiPort }, 'api.listening');
  } catch (err) {
    logger.error({ err }, 'api.failed_to_start');
    process.exit(1);
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      logger.info({ sig }, 'api.shutting_down');
      await app.close();
      process.exit(0);
    });
  }
}

main();
