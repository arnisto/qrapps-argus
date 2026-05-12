# Changelog

All notable changes to Argus are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo scaffold (`apps/`, `packages/`, `docker/`, `infra/`, `docs/`).
- Postgres connector (read-only, poll-based) with cursor management.
- Event schema, ingestion endpoint, and BullMQ-backed event bus.
- Investigator runtime with structured-output enforcement and evidence-cite validation.
- Two builtin investigators: `ghost-delivery`, `refund-anomaly`.
- AI provider abstraction with Claude + OpenAI + Gemini implementations and a `mock` test provider.
- Slack alert channel.
- Next.js dashboard (Findings, Investigators, Connectors).
- One-command Docker Compose stack.
- Documentation: VISION, ARCHITECTURE, MVP_SCOPE, ROADMAP, INVESTIGATORS, CONNECTORS, AI_PROVIDERS, EVENTS, DEVELOPMENT, CONTRIBUTING, OPEN_SOURCE_STRATEGY.
