import { Queue, Worker } from 'bullmq';
import { childLogger, AppError } from '@argus/shared';
import { QUEUES, type Event } from '@argus/events';
import {
  parseInvestigator,
  lookbackToMs,
  runInvestigator,
  runPipeline,
  type Agent,
  type AgentRunRecord,
  type Finding,
} from '@argus/investigators';
import { redis } from '../connection.js';
import { db } from '../db.js';

interface RunJob {
  investigator_id: string;
  trigger: { kind: 'event'; event_id: string } | { kind: 'schedule' };
}

/**
 * Pull an `investigators.run` job, hydrate the definition + context events,
 * dispatch to either the v1 single-call runtime or the v2 pipeline runtime
 * based on whether the investigator has `pipeline_agents` rows, persist the
 * result, and enqueue an alert dispatch when severity meets the threshold.
 */
export async function startInvestigatorWorker(): Promise<() => Promise<void>> {
  const log = childLogger({ component: 'workers.investigator-run' });
  const alertQueue = new Queue(QUEUES.alertsDispatch, { connection: redis() });

  const worker = new Worker<RunJob>(
    QUEUES.investigatorsRun,
    async (job) => {
      const { investigator_id, trigger } = job.data;

      const invRow = await db().query<{ definition: unknown }>(
        `SELECT definition FROM investigators WHERE id = $1 AND enabled = true`,
        [investigator_id],
      );
      if (invRow.rowCount === 0) {
        log.warn({ investigator_id }, 'investigator.disabled_or_missing');
        return;
      }

      // Look up the pipeline composition + the resolved LLM credential per
      // agent in a single query. Resolution rules (left joins so missing rows
      // are tolerated):
      //   - If the agent has `credential_id` → use that row's key + model.
      //   - Else → use the per-provider default credential (is_default = true).
      //   - Else → leave `api_key_enc` / `cred_default_model` NULL and the
      //     registry will fall back to env vars.
      const pipelineRows = await db().query<
        Agent & {
          reads_from: 'all' | string[];
          position: number;
          api_key_enc: string | null;
          cred_default_model: string | null;
        }
      >(
        `SELECT a.id, a.name, a.description, a.provider, a.model,
                a.system_prompt, a.user_prompt_template, a.output_schema_kind,
                a.source, pa.position, pa.reads_from,
                COALESCE(c.api_key_enc, d.api_key_enc)         AS api_key_enc,
                COALESCE(c.default_model, d.default_model)     AS cred_default_model
         FROM pipeline_agents pa
         JOIN agents a ON a.id = pa.agent_id
         LEFT JOIN llm_credentials c ON c.id = a.credential_id
         LEFT JOIN llm_credentials d ON d.provider = a.provider AND d.is_default = true
         WHERE pa.investigator_id = $1
         ORDER BY pa.position ASC`,
        [investigator_id],
      );

      const isPipeline = (pipelineRows.rowCount ?? 0) > 0;
      const definition = parseInvestigator(invRow.rows[0]!.definition);

      let triggerEvent: Event | undefined;
      if (trigger.kind === 'event') {
        const evRow = await db().query<Event>(
          `SELECT * FROM events WHERE event_id = $1`,
          [trigger.event_id],
        );
        if (evRow.rowCount === 0) {
          log.warn({ event_id: trigger.event_id }, 'investigator.trigger_event_missing');
          return;
        }
        triggerEvent = evRow.rows[0];
      }

      const sinceMs = Date.now() - lookbackToMs(definition.context.lookback);
      const types = Array.from(
        new Set([...definition.triggers.events, ...definition.context.related_events]),
      );

      // Pull the MOST RECENT max_events within the lookback window, then reverse
      // so the AI sees them oldest-first in the prompt.
      const ctxRowsDesc = await db().query<Event>(
        `SELECT * FROM events
         WHERE event_type = ANY($1::text[])
           AND occurred_at >= to_timestamp($2 / 1000.0)
         ORDER BY occurred_at DESC
         LIMIT $3`,
        [types, sinceMs, definition.context.max_events],
      );
      const contextEvents = ctxRowsDesc.rows.slice().reverse();

      const investigation = await db().query<{ id: string }>(
        `INSERT INTO investigations (investigator_id, triggered_by, status)
         VALUES ($1, $2::jsonb, 'running')
         RETURNING id`,
        [investigator_id, JSON.stringify(trigger)],
      );
      const investigationId = investigation.rows[0]!.id;

      if (isPipeline) {
        await runPipelineBranch({
          investigationId,
          investigator_id,
          definition,
          trigger,
          triggerEvent,
          contextEvents,
          agents: pipelineRows.rows,
          alertQueue,
          log,
        });
      } else {
        await runLegacyBranch({
          investigationId,
          investigator_id,
          definition,
          trigger,
          triggerEvent,
          contextEvents,
          alertQueue,
        });
      }
    },
    { connection: redis(), concurrency: 4 },
  );

  worker.on('failed', (job, err) =>
    log.error({ err, jobId: job?.id, data: job?.data }, 'investigator.run.failed'),
  );

  return async () => {
    await worker.close();
    await alertQueue.close();
  };
}

// ---------------------------------------------------------------------------
// Legacy single-call branch (unchanged behavior from v0.1).
// ---------------------------------------------------------------------------

async function runLegacyBranch(opts: {
  investigationId: string;
  investigator_id: string;
  definition: ReturnType<typeof parseInvestigator>;
  trigger: RunJob['trigger'];
  triggerEvent: Event | undefined;
  contextEvents: Event[];
  alertQueue: Queue;
}): Promise<void> {
  const { investigationId, definition, trigger, triggerEvent, contextEvents, alertQueue } = opts;
  try {
    const result = await runInvestigator({
      definition,
      trigger: { kind: trigger.kind, ...(triggerEvent ? { event: triggerEvent } : {}) },
      contextEvents,
    });

    const findingId = await persistFinding(investigationId, result.finding);

    await db().query(
      `UPDATE investigations
       SET finished_at = now(), status = 'succeeded',
           provider = $2, model = $3, tokens_input = $4, tokens_output = $5
       WHERE id = $1`,
      [
        investigationId,
        result.provider,
        result.model,
        result.usage.inputTokens,
        result.usage.outputTokens,
      ],
    );

    if (result.shouldAlert) {
      for (const channelId of definition.output.alert_channels) {
        await alertQueue.add(
          'dispatch',
          { finding_id: findingId, channel_id: channelId },
          {
            removeOnComplete: 500,
            removeOnFail: 1000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
          },
        );
      }
    }
  } catch (err) {
    await db().query(
      `UPDATE investigations SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1`,
      [investigationId, (err as Error).message],
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Multi-agent pipeline branch.
// ---------------------------------------------------------------------------

async function runPipelineBranch(opts: {
  investigationId: string;
  investigator_id: string;
  definition: ReturnType<typeof parseInvestigator>;
  trigger: RunJob['trigger'];
  triggerEvent: Event | undefined;
  contextEvents: Event[];
  /**
   * Rows from the pipeline_agents → agents → llm_credentials join. The two
   * cred columns (`api_key_enc`, `cred_default_model`) are mapped to the
   * runtime's `apiKey`/`apiKeyModel` before the call.
   */
  agents: Array<
    Agent & {
      reads_from: 'all' | string[];
      position: number;
      api_key_enc: string | null;
      cred_default_model: string | null;
    }
  >;
  alertQueue: Queue;
  log: ReturnType<typeof childLogger>;
}): Promise<void> {
  const {
    investigationId,
    investigator_id,
    definition,
    trigger,
    triggerEvent,
    contextEvents,
    agents,
    alertQueue,
    log,
  } = opts;

  try {
    const result = await runPipeline({
      pipeline: {
        id: investigator_id,
        name: definition.name,
        description: definition.description,
        context: {
          lookback: definition.context.lookback,
          related_events: definition.context.related_events,
          max_events: definition.context.max_events,
        },
        severity_threshold: definition.severity_threshold,
      },
      trigger: { kind: trigger.kind, ...(triggerEvent ? { event: triggerEvent } : {}) },
      contextEvents,
      // Map the joined credential columns to the runtime's transient fields.
      // Undefined means "use env fallback" — registry handles it.
      agents: agents.map((a) => ({
        ...a,
        ...(a.api_key_enc ? { apiKey: a.api_key_enc } : {}),
        ...(a.cred_default_model ? { apiKeyModel: a.cred_default_model } : {}),
      })),
    });

    await persistAgentRuns(investigationId, result.agentRuns);
    const findingId = await persistFinding(investigationId, result.finding);

    await db().query(
      `UPDATE investigations
       SET finished_at = now(), status = 'succeeded',
           provider = $2, model = $3, tokens_input = $4, tokens_output = $5
       WHERE id = $1`,
      [
        investigationId,
        result.finalProvider,
        result.finalModel,
        result.totals.inputTokens,
        result.totals.outputTokens,
      ],
    );

    if (result.shouldAlert) {
      for (const channelId of definition.output.alert_channels) {
        await alertQueue.add(
          'dispatch',
          { finding_id: findingId, channel_id: channelId },
          {
            removeOnComplete: 500,
            removeOnFail: 1000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
          },
        );
      }
    }

    log.info(
      { investigation_id: investigationId, agents: result.agentRuns.length },
      'pipeline.investigation.succeeded',
    );
  } catch (err) {
    // The orchestrator attaches partial agent_runs in err.meta when it aborts.
    const partial =
      err instanceof AppError && Array.isArray((err.meta as { agent_runs?: unknown[] } | undefined)?.agent_runs)
        ? ((err.meta as { agent_runs: AgentRunRecord[] }).agent_runs)
        : [];
    if (partial.length > 0) {
      await persistAgentRuns(investigationId, partial).catch((persistErr) =>
        log.error({ err: persistErr }, 'pipeline.agent_runs.persist_failed'),
      );
    }
    await db().query(
      `UPDATE investigations SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1`,
      [investigationId, (err as Error).message],
    );
    throw err;
  }
}

async function persistAgentRuns(
  investigationId: string,
  runs: AgentRunRecord[],
): Promise<void> {
  if (runs.length === 0) return;
  // One short tx so a partial trail is written atomically.
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    for (const r of runs) {
      await client.query(
        `INSERT INTO agent_runs
           (investigation_id, agent_id, position, status, started_at, finished_at,
            provider, model, system_prompt_rendered, user_prompt_rendered,
            output_json, output_text, tokens_input, tokens_output, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)`,
        [
          investigationId,
          r.agent_id,
          r.position,
          r.status,
          r.started_at,
          r.finished_at,
          r.provider,
          r.model,
          r.system_prompt_rendered,
          r.user_prompt_rendered,
          r.output_json === null ? null : JSON.stringify(r.output_json),
          r.output_text,
          r.tokens_input,
          r.tokens_output,
          r.error,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function persistFinding(investigationId: string, finding: Finding): Promise<string> {
  const result = await db().query<{ id: string }>(
    `INSERT INTO findings (investigation_id, investigator_id, severity, summary, evidence, recommendation, impact_estimate)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
     RETURNING id`,
    [
      investigationId,
      finding.investigator_id,
      finding.severity,
      finding.summary,
      JSON.stringify(finding.evidence),
      finding.recommendation ?? null,
      finding.impact_estimate ? JSON.stringify(finding.impact_estimate) : null,
    ],
  );
  return result.rows[0]!.id;
}
