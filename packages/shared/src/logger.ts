import pino from 'pino';

const level = process.env.ARGUS_LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  base: { service: process.env.ARGUS_SERVICE_NAME ?? 'argus' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export type Logger = typeof logger;

/** Create a child logger with extra bindings (e.g. investigator_id). */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
