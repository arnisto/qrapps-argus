# Contributing

Thanks for being interested in Argus. This doc explains how to contribute productively.

## What we accept

✅ **Yes please:**

- New connectors for mainstream sources (Stripe, Shopify, MongoDB, BigQuery, etc.)
- New investigator templates for common operational anomalies
- New AI provider implementations
- New alert channels
- Bug fixes with regression tests
- Doc improvements
- Performance fixes with benchmarks

❌ **Likely no, please open an issue first:**

- Major architectural rewrites
- Adding Kubernetes manifests as the *primary* deploy story (Compose stays first-class)
- Vector DB additions before v0.5
- Microservice splits
- Web UI redesigns
- Anything that changes the open-core boundary

## Before you write code

Open an issue. Describe:

1. The problem (what operational scenario, what's broken).
2. The proposed change.
3. Whether it touches the runtime, packages, or apps.

We'll respond with "go ahead", "let's discuss the design first", or "this is out of scope". This saves everyone time.

## Pull request checklist

- [ ] Conventional commit messages (`feat:`, `fix:`, `docs:`, etc.)
- [ ] Branched from `main`; rebased, not merged
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] New code has tests
- [ ] If you touched a public interface: docs updated
- [ ] If you added env vars: `.env.example` updated
- [ ] If you added a connector/investigator/provider: the relevant doc page updated

## Code style

- TypeScript strict. No `any` without a `// reason: ...` comment.
- Prefer explicit types on exported functions.
- Zod validate at trust boundaries (API ingress, connector outputs, AI responses).
- Errors are typed (`AppError` subclasses); no `throw new Error('string')` in production paths.
- Logging via `packages/shared/logger` — never `console.log` outside of one-off scripts.
- No wall-of-comments. Code reads like the surrounding code.

## Testing

- **Unit tests** live next to the code: `src/foo.ts` → `src/__tests__/foo.test.ts`.
- **Investigator tests** use fixture event files in `packages/investigators/src/__tests__/fixtures/`.
- **AI provider tests** use the `mock` provider for determinism. Real provider calls go in `*.integration.test.ts` and are gated behind env keys, off by default in CI.
- **End-to-end** tests live in `e2e/` and run against a Compose stack.

Coverage is not a target. Useful tests are the target.

## Reviewing

Reviewers look for:

1. **Does it fit the vision?** (See [VISION.md](./VISION.md))
2. **Does it stay in scope?** (See [MVP_SCOPE.md](./MVP_SCOPE.md) / [ROADMAP.md](./ROADMAP.md))
3. **Does it respect the abstractions?** (Connectors don't call investigators, investigators don't call providers directly bypassing the abstraction, etc.)
4. **Can it be tested?**
5. **Will it confuse a self-hoster reading the docs in a year?**

## Releases

- We use semver: `MAJOR.MINOR.PATCH`.
- v0.x is the "API may break" phase. We try not to break things, but we will if a better design appears.
- Each minor version ships a CHANGELOG entry, a Compose tag, and a migration guide if needed.

## Code of conduct

Be kind. Argue ideas, not people. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## Licensing

By contributing you agree your contribution is licensed under Apache-2.0 (see [LICENSE](../LICENSE)). Don't paste code from incompatibly licensed sources.

## Questions

Open a discussion on GitHub or hop into the community Discord (link in README once it exists).
