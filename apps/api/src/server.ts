import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { loadConfig, AppError } from '@argus/shared';
import { registerHealthRoutes } from './routes/health.js';
import { registerEventRoutes } from './routes/events.js';
import { registerFindingRoutes } from './routes/findings.js';
import { registerInvestigatorRoutes } from './routes/investigators.js';
import { registerConnectorRoutes } from './routes/connectors.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerInvestigationRoutes } from './routes/investigations.js';
import { registerAlertChannelRoutes } from './routes/alert-channels.js';
import { registerLlmCredentialRoutes } from './routes/llm-credentials.js';

export async function buildServer() {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      base: { service: 'argus-api' },
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(cors, { origin: true });
  await app.register(sensible);

  // Auth: bearer-token gate for everything except healthz.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/healthz')) return;
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${config.ingestToken}`) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.status).send({ error: err.code, message: err.message, meta: err.meta });
      return;
    }
    app.log.error({ err }, 'api.unhandled_error');
    reply.code(500).send({ error: 'internal_error' });
  });

  await registerHealthRoutes(app);
  await registerEventRoutes(app);
  await registerFindingRoutes(app);
  await registerInvestigatorRoutes(app);
  await registerConnectorRoutes(app);
  await registerAgentRoutes(app);
  await registerInvestigationRoutes(app);
  await registerAlertChannelRoutes(app);
  await registerLlmCredentialRoutes(app);

  return app;
}
