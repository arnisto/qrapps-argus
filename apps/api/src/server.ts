import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
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
import multipart from '@fastify/multipart';
import { registerAuthRoutes } from './routes/auth.js';
import { registerEnvRoutes } from './routes/envs.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerChatRoutes } from './routes/chat.js';
import { attachUser } from './auth/middleware.js';

// Routes that are publicly callable WITHOUT the dashboard session gate.
//   · auth/* — the user is in the middle of signing in
//   · healthz — needs to work for liveness probes
//   · v1/* — the developer API. Owns its own bearer auth (api_keys table)
//     so the global gate must NOT 401 it before its handler runs.
const PUBLIC_PREFIXES = [
  '/healthz',
  '/auth/signup',
  '/auth/signin',
  '/auth/signout',
  '/v1/',
];

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

  await app.register(cors, {
    // Dev: dashboard is on :3000, api on :4000. Cookies require credentials:
    // 'include' on the fetch + an explicit allow-list origin (NOT `*`).
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl
      const ok = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      cb(null, ok);
    },
    credentials: true,
  });
  await app.register(sensible);
  await app.register(cookie);
  // Multipart only for source upload — limits enforced per-route. 6 MB
  // global ceiling so an oversized request doesn't tie up the loop.
  await app.register(multipart, {
    limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  });

  // Hydrate req.user from the session cookie if present. Never fails the
  // request — public routes pass through with req.user undefined.
  app.addHook('onRequest', attachUser);

  // Hybrid gate:
  //   · public prefixes (healthz, /auth/signin/up/out) → no auth
  //   · everything else: accept EITHER a valid session cookie (req.user)
  //     OR the legacy bearer ARGUS_INGEST_TOKEN (workers, connectors).
  app.addHook('onRequest', async (req, reply) => {
    if (PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;
    if (req.user) return;
    const auth = req.headers.authorization;
    if (auth === `Bearer ${config.ingestToken}`) return;
    reply.code(401).send({ error: 'unauthorized' });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.status).send({ error: err.code, message: err.message, meta: err.meta });
      return;
    }
    app.log.error({ err }, 'api.unhandled_error');
    reply.code(500).send({ error: 'internal_error' });
  });

  await registerAuthRoutes(app);
  await registerEnvRoutes(app);
  await registerProviderRoutes(app);
  await registerApiKeyRoutes(app);
  await registerSourceRoutes(app);
  await registerChatRoutes(app);
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
