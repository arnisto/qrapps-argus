/**
 * Per-env sources (knowledge).
 *
 *   GET    /envs/:slug/sources                list (with per-source chunk count)
 *   POST   /envs/:slug/sources                multipart upload — one file at a time
 *   POST   /envs/:slug/sources/qa             { question, answer } — high-authority Q&A
 *   DELETE /envs/:slug/sources/:id            cascade delete (chunks go with it)
 *
 * The upload path is synchronous in the request: parse the file, chunk,
 * embed each chunk via Gemini, insert into `chunks`. Production-grade we'd
 * push to BullMQ — but for the demo we want the UI to show "12 chunks
 * indexed" immediately rather than a "queued" toast.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser } from '../auth/middleware.js';
import { chunk, estimateTokens, htmlToText } from '../llm/chunk.js';
import { embed } from '../llm/gemini.js';
import { toPgvectorLiteral } from '../llm/pgvector.js';
import { resolveEnv } from './env-scope.js';
import { loadProviderForEnv } from './providers.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — generous for markdown/text
const MAX_FILES = 1;               // multipart hardened: one file per request

function extractText(filename: string, body: Buffer): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    return body.toString('utf8');
  }
  if (ext === 'html' || ext === 'htm') {
    return htmlToText(body.toString('utf8'));
  }
  // PDF would go here with `pdf-parse`; left as a follow-up so we don't
  // wedge the demo on an optional dependency install.
  throw new Error(`unsupported file type .${ext} — use md, txt, or html for now`);
}

async function ingestText(
  envId: string,
  userId: string,
  title: string,
  text: string,
  kind: 'file' | 'qa',
  authority: number,
  uri: string | null,
): Promise<{ source_id: string; chunks: number; tokens: number }> {
  const parts = kind === 'qa' ? [text] : chunk(text);
  if (parts.length === 0) throw new Error('no extractable text');

  const provider = await loadProviderForEnv(envId, 'gemini');
  if (!provider) {
    throw new Error('no gemini provider configured — connect one before uploading');
  }

  // Embed first so we don't insert a source if Gemini is down.
  const vectors = await embed(provider, parts, 768);

  const { rows: srcRows } = await db().query<{ id: string }>(
    `INSERT INTO sources (env_id, kind, title, uri, bytes, authority, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [envId, kind, title.slice(0, 160), uri, Buffer.byteLength(text), authority, userId],
  );
  const sourceId = srcRows[0]!.id;

  let totalTokens = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const content = parts[i]!;
    const vec = vectors[i]!;
    const tokens = estimateTokens(content);
    totalTokens += tokens;
    const lit = toPgvectorLiteral(vec);
    await db().query(
      `INSERT INTO chunks (env_id, source_id, ord, text, tokens, embedding)
            VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [envId, sourceId, i, content, tokens, lit],
    );
  }
  return { source_id: sourceId, chunks: parts.length, tokens: totalTokens };
}

const QaBody = z.object({
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(20_000),
});

export async function registerSourceRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /envs/:slug/sources ---------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/envs/:slug/sources',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const { rows } = await db().query<{
        id: string;
        kind: string;
        title: string;
        uri: string | null;
        bytes: number | null;
        authority: number;
        created_at: string;
        chunks: number;
      }>(
        `SELECT s.id, s.kind, s.title, s.uri, s.bytes, s.authority, s.created_at,
                (SELECT COUNT(*)::int FROM chunks c WHERE c.source_id = s.id) AS chunks
           FROM sources s
          WHERE s.env_id = $1
          ORDER BY s.created_at DESC`,
        [env.id],
      );
      return { sources: rows };
    },
  );

  // ---- POST /envs/:slug/sources --------------------------------------------
  // Multipart file upload. Accepts one file per request — keeps the
  // synchronous-embed path manageable in the demo.
  app.post<{ Params: { slug: string } }>(
    '/envs/:slug/sources',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      if (!req.isMultipart()) {
        return reply.code(400).send({ error: 'expected_multipart_form' });
      }
      const part = await req.file({ limits: { fileSize: MAX_BYTES, files: MAX_FILES } });
      if (!part) return reply.code(400).send({ error: 'no_file_uploaded' });
      const buf = await part.toBuffer();
      try {
        const text = extractText(part.filename, buf);
        const result = await ingestText(
          env.id,
          req.user!.id,
          part.filename,
          text,
          'file',
          60, // authority on 0..100; files default mid-trust
          part.filename,
        );
        return reply.code(201).send({ source: result });
      } catch (err) {
        return reply.code(400).send({ error: 'ingest_failed', message: (err as Error).message });
      }
    },
  );

  // ---- POST /envs/:slug/sources/qa -----------------------------------------
  app.post<{ Params: { slug: string } }>(
    '/envs/:slug/sources/qa',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const parsed = QaBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
      }
      const { question, answer } = parsed.data;
      const content = `Q: ${question.trim()}\nA: ${answer.trim()}`;
      try {
        const result = await ingestText(
          env.id,
          req.user!.id,
          question.trim().slice(0, 160),
          content,
          'qa',
          90, // Q&A is high-authority — humans wrote it on purpose
          null,
        );
        return reply.code(201).send({ source: result });
      } catch (err) {
        return reply.code(400).send({ error: 'ingest_failed', message: (err as Error).message });
      }
    },
  );

  // ---- DELETE /envs/:slug/sources/:id --------------------------------------
  app.delete<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/sources/:id',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      await db().query(
        `DELETE FROM sources WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      return reply.code(204).send();
    },
  );
}
