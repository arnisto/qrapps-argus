/**
 * Seed builtin agents + investigators from packages/investigators/templates/.
 *
 * Two YAML shapes:
 *   templates/agents/*.yaml  — Agent (v0.2 reusable LLM step)
 *   templates/*.yaml         — Investigator. Detected by content:
 *                                `agents:` ⇒ v2 pipeline
 *                                `checks:` ⇒ v1 legacy single-call
 *
 * Idempotent and SAFE for user customizations:
 *   - Builtin agents UPSERT only when `agents.source = 'builtin'` (so a user
 *     who renames a builtin to source='user' keeps their changes).
 *   - v2 pipelines replace `pipeline_agents` rows on every seed (DELETE +
 *     INSERT), wrapped in one transaction per pipeline.
 *   - v2 templates take precedence when both v1 and v2 files exist with the
 *     same investigator id (we seed v2 last).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger, loadConfig } from '@argus/shared';
import {
  loadInvestigatorFromYaml,
  loadAgentFromYaml,
  loadInvestigatorV2FromYaml,
} from '@argus/investigators';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const config = loadConfig();
  const templatesDir = resolve(__dirname, '..', '..', '..', 'packages', 'investigators', 'templates');
  const agentDir = resolve(templatesDir, 'agents');

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await seedAgents(client, agentDir);
    await seedInvestigators(client, templatesDir);
  } finally {
    await client.end();
  }
}

async function seedAgents(client: pg.Client, agentDir: string): Promise<void> {
  let files: string[] = [];
  try {
    files = readdirSync(agentDir).filter((f) => f.endsWith('.yaml'));
  } catch {
    // No agents/ directory present — older repo state. Nothing to seed.
    return;
  }
  for (const file of files) {
    const agent = loadAgentFromYaml(resolve(agentDir, file));
    // Refuse to overwrite a row a user has converted to source='user'.
    await client.query(
      `INSERT INTO agents
         (id, name, description, provider, model, system_prompt,
          user_prompt_template, output_schema_kind, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'builtin')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         system_prompt = EXCLUDED.system_prompt,
         user_prompt_template = EXCLUDED.user_prompt_template,
         output_schema_kind = EXCLUDED.output_schema_kind,
         updated_at = now()
       WHERE agents.source = 'builtin'`,
      [
        agent.id,
        agent.name,
        agent.description ?? null,
        agent.provider,
        agent.model,
        agent.system_prompt,
        agent.user_prompt_template ?? null,
        agent.output_schema_kind,
      ],
    );
    logger.info({ id: agent.id }, 'seed.agent.upserted');
  }
}

async function seedInvestigators(client: pg.Client, templatesDir: string): Promise<void> {
  const files = readdirSync(templatesDir)
    .filter((f) => f.endsWith('.yaml'))
    // Seed v1 first then v2 so v2 wins when both exist with the same id.
    .sort((a, b) => Number(isV2File(templatesDir, a)) - Number(isV2File(templatesDir, b)));

  for (const file of files) {
    const fullPath = resolve(templatesDir, file);
    if (isV2File(templatesDir, file)) {
      const v2 = loadInvestigatorV2FromYaml(fullPath);
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO investigators
             (id, name, description, definition, enabled,
              severity_threshold, provider, source, definition_schema_version)
           VALUES ($1, $2, $3, $4::jsonb, true, $5, NULL, 'builtin', 2)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             definition = EXCLUDED.definition,
             severity_threshold = EXCLUDED.severity_threshold,
             provider = NULL,
             definition_schema_version = 2,
             updated_at = now()
           WHERE investigators.source = 'builtin'`,
          [
            v2.id,
            v2.name,
            v2.description,
            JSON.stringify(v2DefinitionJsonb(v2)),
            v2.severity_threshold,
          ],
        );

        // Replace the pipeline rows. RESTRICT on the agent FK protects against
        // races; we run inside a tx so the DELETE+INSERT is atomic.
        await client.query('DELETE FROM pipeline_agents WHERE investigator_id = $1', [v2.id]);
        for (let i = 0; i < v2.agents.length; i++) {
          const a = v2.agents[i]!;
          await client.query(
            `INSERT INTO pipeline_agents (investigator_id, agent_id, position, reads_from)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [v2.id, a.agent_id, i, JSON.stringify(a.reads_from)],
          );
        }
        await client.query('COMMIT');
        logger.info({ id: v2.id, agents: v2.agents.length }, 'seed.investigator.v2.upserted');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    } else {
      // v1 legacy: keep the existing single-call upsert path for backward
      // compat. Guarded so user customizations aren't blown away.
      const def = loadInvestigatorFromYaml(fullPath);
      await client.query(
        `INSERT INTO investigators
           (id, name, description, definition, enabled,
            severity_threshold, provider, source, definition_schema_version)
         VALUES ($1, $2, $3, $4::jsonb, true, $5, $6, 'builtin', 1)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           definition = EXCLUDED.definition,
           severity_threshold = EXCLUDED.severity_threshold,
           provider = EXCLUDED.provider,
           definition_schema_version = 1,
           updated_at = now()
         WHERE investigators.source = 'builtin'`,
        [
          def.id,
          def.name,
          def.description,
          JSON.stringify(def),
          def.severity_threshold,
          def.provider ?? null,
        ],
      );
      logger.info({ id: def.id }, 'seed.investigator.v1.upserted');
    }
  }
}

function isV2File(dir: string, file: string): boolean {
  const raw = readFileSync(resolve(dir, file), 'utf8');
  // Cheap shape probe — looks for a top-level `agents:` list. False positives
  // would require a literal "agents:" in another context; acceptable here.
  return /^agents:/m.test(raw);
}

function v2DefinitionJsonb(v2: ReturnType<typeof loadInvestigatorV2FromYaml>): Record<string, unknown> {
  return {
    id: v2.id,
    name: v2.name,
    description: v2.description,
    triggers: v2.triggers,
    context: v2.context,
    severity_threshold: v2.severity_threshold,
    output: v2.output,
    definition_schema_version: 2,
  };
}

main().catch((err) => {
  logger.error({ err }, 'db.seed.failed');
  process.exit(1);
});
