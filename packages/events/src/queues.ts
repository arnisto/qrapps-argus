/**
 * Canonical BullMQ queue names. Treat as a closed set.
 *
 * Note: BullMQ uses `:` as its Redis key separator and rejects queue names
 * containing it. Names are dot-separated for readability.
 */
export const QUEUES = {
  /** Connector polling jobs. One repeatable job per enabled connector. */
  connectorsPoll: 'connectors.poll',

  /** New events fan-out: route a single event to subscribed investigators. */
  eventsProcess: 'events.process',

  /** Investigator runs (event-triggered or scheduled). */
  investigatorsRun: 'investigators.run',

  /** Alert dispatch to channels (Slack, Discord, email, webhook). */
  alertsDispatch: 'alerts.dispatch',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
