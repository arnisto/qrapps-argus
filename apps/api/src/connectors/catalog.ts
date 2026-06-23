/**
 * The marketplace catalog — the source of truth for what kinds of
 * connectors operators can set up from the dashboard.
 *
 * Each entry declares:
 *   · its identity (subtype + kind + name + tagline)
 *   · the form fields the dashboard renders for credentials
 *   · the runtime status — `available` ships in this milestone,
 *     `coming_soon` is shown but not connectable yet (signals roadmap
 *     to the buyer without us having to lie about the surface area).
 *
 * KEEP THIS STATIC. The catalog is published JSON to anyone calling
 * `/connectors/catalog` and is consumed by the Connect modal. New
 * connectors get added here AND in `apps/api/src/connectors/adapters/`.
 */

export type ConnectorKind = 'db' | 'channel' | 'tool' | 'doc';
export type ConnectorStatus = 'available' | 'coming_soon';

export interface CatalogField {
  /** Form field name; ends up in `config` (or `secret` if `secret: true`). */
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea';
  placeholder?: string;
  hint?: string;
  required?: boolean;
  default?: string | number;
  /** Where this field lands on POST. `config` is plaintext JSONB; `secret` is encrypted. */
  bucket: 'config' | 'secret';
  /** Only set on `secret` fields — these are never returned on GET. */
  secret?: boolean;
  /** For `type: 'select'`. */
  options?: Array<{ value: string; label: string }>;
}

export interface CatalogEntry {
  subtype: string;
  kind: ConnectorKind;
  name: string;
  tagline: string;
  /** SVG path data for a 20×20 monogram in the marketplace card. */
  icon: string;
  status: ConnectorStatus;
  /** Tag chips for filtering ("inbound", "outbound", "live-data", …). */
  tags: string[];
  /** Form schema the dashboard renders. */
  fields: CatalogField[];
  /** One-liner shown in the Connect modal footer. */
  whatItUnlocks: string;
}

export const CATALOG: CatalogEntry[] = [
  // ─────────────────────────── DB ───────────────────────────
  {
    subtype: 'postgres',
    kind: 'db',
    name: 'PostgreSQL',
    tagline: 'Read-only, live query, schema auto-indexed.',
    icon: 'PG',
    status: 'available',
    tags: ['live data', 'read-only', 'sql'],
    whatItUnlocks:
      'Argus can answer "how many orders last week?" with a real SELECT. Schema + sample rows auto-indexed so chats become table-aware.',
    fields: [
      { name: 'host', label: 'Host', type: 'text', placeholder: 'db.acme.com', required: true, bucket: 'config' },
      { name: 'port', label: 'Port', type: 'number', default: 5432, required: true, bucket: 'config' },
      { name: 'database', label: 'Database', type: 'text', placeholder: 'acme', required: true, bucket: 'config' },
      { name: 'user', label: 'User', type: 'text', placeholder: 'argus_readonly', required: true, bucket: 'config', hint: 'A SELECT-only role is strongly recommended.' },
      { name: 'password', label: 'Password', type: 'password', required: true, bucket: 'secret', secret: true, hint: 'Stored AES-GCM-encrypted; plaintext never leaves the API after submission.' },
      {
        name: 'ssl',
        label: 'SSL mode',
        type: 'select',
        default: 'prefer',
        bucket: 'config',
        options: [
          { value: 'disable', label: 'disable' },
          { value: 'prefer', label: 'prefer (default)' },
          { value: 'require', label: 'require' },
        ],
      },
      { name: 'schema_allowlist', label: 'Schemas to crawl', type: 'text', placeholder: 'public', default: 'public', bucket: 'config', hint: 'Comma-separated. Leave as `public` if unsure.' },
      { name: 'sample_rows', label: 'Sample rows per table', type: 'number', default: 25, bucket: 'config', hint: 'Set to 0 to skip samples and only index the schema (zero PII path).' },
    ],
  },

  // ─────────────────────────── CHANNEL ───────────────────────────
  {
    subtype: 'slack',
    kind: 'channel',
    name: 'Slack',
    tagline: 'Two-way chat with members. The Interview loop runs here.',
    icon: 'SL',
    status: 'available',
    tags: ['outbound', 'send', 'interview-loop'],
    whatItUnlocks:
      'Argus can DM a teammate to ask a question and send grounded replies back. Inbound webhook (Argus listens for replies) ships in M7.3.',
    fields: [
      { name: 'team_name', label: 'Workspace name', type: 'text', placeholder: 'Acme', required: true, bucket: 'config', hint: 'Just a label — what should this connection show up as.' },
      { name: 'bot_token', label: 'Bot User OAuth Token', type: 'password', placeholder: 'xoxb-…', required: true, bucket: 'secret', secret: true, hint: 'From OAuth & Permissions in your Slack app config. Bot scope needs at minimum chat:write.' },
      { name: 'signing_secret', label: 'Signing Secret', type: 'password', placeholder: '••••••••', required: false, bucket: 'secret', secret: true, hint: 'Required once we wire inbound webhooks (M7.3). You can leave blank for outbound-only today.' },
      { name: 'default_channel', label: 'Default channel', type: 'text', placeholder: '#argus-asks', bucket: 'config', hint: 'Where the Test ping lands. Defaults to the bot user if blank.' },
    ],
  },

  // ─────────────────────────── DOC SYNC ───────────────────────────
  {
    subtype: 'notion',
    kind: 'doc',
    name: 'Notion',
    tagline: 'Auto-sync your team workspace. New pages → indexed.',
    icon: 'NT',
    status: 'coming_soon',
    tags: ['auto-sync', 'docs'],
    whatItUnlocks:
      'Every page in the picked workspace gets crawled + chunked + embedded. Updates re-ingest hourly. No more manual uploads.',
    fields: [
      { name: 'workspace_name', label: 'Workspace name', type: 'text', placeholder: 'Acme HQ', required: true, bucket: 'config' },
      { name: 'integration_token', label: 'Internal Integration Token', type: 'password', placeholder: 'secret_…', required: true, bucket: 'secret', secret: true, hint: 'From Notion → Settings → Integrations → New internal integration.' },
    ],
  },

  {
    subtype: 'google_drive',
    kind: 'doc',
    name: 'Google Drive',
    tagline: 'Watch a folder, ingest the docs you drop into it.',
    icon: 'GD',
    status: 'coming_soon',
    tags: ['auto-sync', 'docs', 'oauth'],
    whatItUnlocks:
      'Pick a Drive folder; every Doc, Slide, and PDF inside is auto-indexed + watched for changes.',
    fields: [
      { name: 'folder_url', label: 'Drive folder URL', type: 'text', placeholder: 'https://drive.google.com/drive/folders/...', required: true, bucket: 'config' },
    ],
  },

  // ─────────────────────────── CHANNEL — EMAIL ───────────────────────────
  {
    subtype: 'email',
    kind: 'channel',
    name: 'Email',
    tagline: 'Universal fallback — IMAP inbound + SMTP outbound.',
    icon: 'EM',
    status: 'coming_soon',
    tags: ['inbound', 'outbound', 'universal'],
    whatItUnlocks:
      'Reply to support@acme via Argus. Drafts grounded, citations carried, human-in-the-loop approval.',
    fields: [
      { name: 'from_addr', label: 'From address', type: 'text', placeholder: 'support@acme.com', required: true, bucket: 'config' },
      { name: 'smtp_host', label: 'SMTP host', type: 'text', placeholder: 'smtp.gmail.com', required: true, bucket: 'config' },
      { name: 'smtp_port', label: 'SMTP port', type: 'number', default: 587, required: true, bucket: 'config' },
      { name: 'smtp_password', label: 'SMTP password', type: 'password', required: true, bucket: 'secret', secret: true },
    ],
  },

  // ─────────────────────────── TOOL ───────────────────────────
  {
    subtype: 'web_search',
    kind: 'tool',
    name: 'Web search',
    tagline: 'Argus can look something up when your docs do not cover it.',
    icon: 'WS',
    status: 'coming_soon',
    tags: ['agent-tool', 'public-data'],
    whatItUnlocks:
      'Adds a `web.search` tool to the agent. Results are observations only — never ingested as authoritative facts.',
    fields: [
      {
        name: 'provider',
        label: 'Provider',
        type: 'select',
        default: 'tavily',
        bucket: 'config',
        options: [
          { value: 'tavily', label: 'Tavily' },
          { value: 'brave', label: 'Brave Search' },
        ],
      },
      { name: 'api_key', label: 'API key', type: 'password', required: true, bucket: 'secret', secret: true },
    ],
  },
];

export function catalogBySubtype(subtype: string): CatalogEntry | null {
  return CATALOG.find((c) => c.subtype === subtype) ?? null;
}
