# Open Source Strategy

Argus is open core. The runtime, the connectors, the dashboard, the investigators — all of it is Apache-2.0 and stays that way. Hosted cloud and enterprise features (the things only large orgs need) are paid.

## What's open source

### Always free, always Apache-2.0

- ✅ Investigator runtime
- ✅ AI investigator engine
- ✅ All builtin connectors (Postgres, MySQL, API, Webhook)
- ✅ Dashboard application
- ✅ Alert channels (Slack, Discord, email, webhook)
- ✅ AI provider abstraction + Claude/OpenAI/Gemini/Ollama/DeepSeek implementations
- ✅ Community investigator templates
- ✅ Plugin SDK (when it lands)
- ✅ Docker Compose deployment
- ✅ All documentation

A self-hoster can stand up a complete, production-grade Argus from this repo with zero paid dependencies (other than their AI provider key).

## What's paid (later)

These land in **Argus Cloud** and **Argus Enterprise**, not here:

- 🔒 Hosted multi-tenant cloud
- 🔒 Enterprise-grade analytics on top of findings
- 🔒 RBAC (roles, permissions, scoped access)
- 🔒 Multi-tenant management (per-org isolation, billing, quotas)
- 🔒 Audit logs (SOC2-grade)
- 🔒 Long-horizon investigation memory (premium reasoning depth)
- 🔒 Advanced AI reasoning (multi-step investigation chains, cross-org learnings — opt-in)
- 🔒 SSO / SCIM
- 🔒 SLA + support

The boundary is intentional: **OSS Argus solves the problem for one org self-hosting; paid Argus solves the problem for many orgs at scale.**

## What we will *not* do

❌ **Open-core bait-and-switch.** We will not move existing OSS features into the paid tier. That's a one-way road to losing the community.

❌ **License changes that hurt self-hosters.** No BSL/SSPL-on-the-runtime moves. If we ever consider a license change, it's discussed publicly with 6+ months notice.

❌ **Cripple the OSS dashboard.** The OSS dashboard ships every feature the paid one does for the *single-org* use case. Cloud only adds the multi-org and enterprise-governance overlays.

❌ **Telemetry without consent.** Anonymous opt-in install pings only, clearly documented, easy to disable.

## Why open source at all

Three reasons:

1. **Trust.** Companies will only point Argus at their production databases if they can read every line of what's running. Open is the only way to earn that.
2. **Distribution.** Operational AI is a category. Categories are won by open standards, not by closed point products.
3. **Composability.** The plugin ecosystem (connectors, investigators, providers) is bigger than what any single team can ship. OSS makes that ecosystem possible.

## Governance

- **BDFL period** — early years, the founding team decides. We'll be transparent about why.
- **Maintainer track** — sustained, high-quality contributions earn maintainer status with merge rights on specific areas.
- **Community council** — once we have ≥ 10 active maintainers, a council of 3–5 governs major decisions (license, architecture splits, governance changes).

## How the paid tier funds the OSS

Revenue from Argus Cloud / Enterprise pays:

- Full-time maintainers on the OSS runtime and connectors.
- Security audits.
- Performance work that benefits all users.
- Doc and onboarding investment.
- Community events / sponsorships.

Self-hosters benefit from paid customers, even if they never pay a cent. That's the deal.

## Trademark

"Argus" and the logo are trademarks of qrapps. The code is Apache-2.0; the brand is not. You can fork the code; you cannot ship a fork called "Argus" without permission. This is standard practice (cf. Mattermost, Sentry, Plausible) and protects users from confusion.
