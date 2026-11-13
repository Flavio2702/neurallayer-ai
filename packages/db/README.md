# @neuralayer/db

Persistence layer and shared DB-backed services for runtime and admin surfaces.

Current contents:

- Drizzle schema and DB connection factories
- `drizzle.config.ts` wired to `@neuralayer/config`
- script entrypoints `db:generate`, `db:migrate`, `db:seed`
- local DB readiness retry for cold starts
- reusable demo seed dataset for local development
- benchmark sync for external model metrics, with Artificial Analysis live fetch or manual JSON import server-side
- explicit Sprint 2 DB services for project lifecycle:
  - `listProjects`
  - `getProjectBySlug`
  - `createProject`
  - `renameProject`
  - `updateProjectSlug`
  - `activateProject`
  - `deactivateProject`
- explicit Sprint 2 DB services for project-scoped gateway API key lifecycle:
  - `generateRawGatewayApiKey`
  - `hashGatewayApiKey`
  - `getGatewayApiKeyPrefix`
  - `createProjectGatewayApiKey`
  - `listProjectGatewayApiKeys`
  - `revokeProjectGatewayApiKey`
  - `touchGatewayApiKeyLastUsedAt`
- explicit Sprint 2 DB services for the workspace budget cap:
  - `getWorkspaceBudgetCap`
  - `upsertWorkspaceBudgetCap`
- explicit Sprint 2 DB services for project guardrails:
  - `upsertProjectPreferredProvider`
  - `upsertProjectAllowedProviders`
  - `getProjectGuardrailsForAdmin`
- explicit Sprint 2 DB services for provider posture and connection test:
  - `recordProviderAccountOperationalOutcome`
  - `testWorkspaceProviderConnection`
- explicit Sprint 2 DB read model for the admin `Requests` page:
  - `getRequestsPageData`
- explicit Sprint 3 DB read model for the manager-safe `Requests` CSV export:
  - `getRequestsCsvExport`
- explicit Sprint 3 DB read model for the shareable `Audit` CSV export:
  - `getAuditCsvExport`
- explicit Sprint 3 DB service for minimal manual request feedback:
  - `upsertManualRequestFeedback`
  - `getLatestManualRequestFeedback`
- explicit Sprint 2 DB read model for admin onboarding progress:
  - `getWorkspaceSetupProgress`
- explicit Sprint 3 DB read model for trial summary:
  - `getTrialSummary`

Current status:

- migrations run against the local Postgres container
- seed creates a minimal demo workspace/project dataset
- project lifecycle writes stay in `src/project-service.ts` with metadata-first audit events and no schema changes
- gateway API key lifecycle writes stay in `src/gateway-api-key-service.ts`, return the raw key only at creation time, and persist only `key_prefix` + `key_hash`
- workspace budget cap writes stay in `src/workspace-budget-cap-service.ts`, reuse `policy_rules` as the runtime source of truth, and avoid a new settings table or `workspaces.metadata` storage
- project guardrail writes stay in `src/project-guardrails-service.ts`, reuse `policy_rules` for `preferred_provider` and `allow_provider`, clear `allowed providers` by deactivating active project allow-lists instead of persisting an empty blocking rule, and expose an admin read model that also warns about active out-of-scope policy types
- provider posture writes stay in `src/provider-account-posture-service.ts`, persist only safe metadata in `provider_accounts.metadata.lastProviderOutcome`, and are shared by gateway runtime and explicit provider tests
- provider connection tests stay in `src/provider-test-service.ts`, reuse `resolveProviderAccountExecutionConfig` for the only decrypt boundary, require an injected runner from `@neuralayer/provider-adapters`, pick the cheapest active chat-capable model for the provider from `model_catalog`, and do not create request/attempt/usage rows
- the `Requests` read model lives in `src/requests-page-service.ts`, composes `feed`, `blockedRecent`, and `recentAudit` without schema changes, stays metadata-first, normalizes legacy or inconsistent request lineage by preferring business-readable blocked outcomes over stale technical statuses when no attempt exists, and adds only the latest per-request `manualFeedback` to the visible feed items
- the `Requests` CSV export read model lives in `src/requests-csv-export-service.ts`, stays anchored to the same rolling `7d` / `30d` semantics as `Trial summary`, reuses the same request lineage precedence as the `Requests` feed, and returns only manager-readable metadata-safe columns
- the `Audit` CSV export read model lives in `src/audit-csv-export-service.ts`, stays anchored to the same rolling `7d` / `30d` semantics as `Trial summary`, exports both runtime and control-plane audit rows inside that window, and returns only narrow metadata-safe columns without raw payload blobs
- the manual request feedback service lives in `src/manual-request-feedback-service.ts`, reuses `audit_events` append-only via `request.feedback_recorded`, keeps the state set narrow (`useful`, `needs_follow_up`, `not_useful`) with an optional short note, treats identical resubmits as no-op, and stays out of routing plus runtime request lineage except for the explicit latest-feedback field exposed by the `Requests` read model
- the `Setup progress` read model lives in `src/setup-progress-service.ts`, reuses provider summaries plus direct project/key/request reads, excludes demo placeholders and demo-tagged project artifacts, and returns only the current five-step onboarding posture instead of workflow history

Canonical local flow:

- `Copy-Item .env.example .env` or `cp .env.example .env`
- `pnpm db:start`
- `pnpm db:migrate`
- `pnpm db:seed`
- `pnpm --filter @neuralayer/db benchmark:sync` for Artificial Analysis benchmark ingestion
- `pnpm db:stop` when finished

Seeded demo dataset:

- workspace `ws_demo` / `demo-workspace`
- owner user `usr_demo_owner` / `owner@demo.neuralayer.local`
- membership `mbr_demo_owner`
- project `proj_demo` / `demo-project`
- routing profile `rprof_demo_base`
- provider accounts `provacc_demo_openai`, `provacc_demo_anthropic`
- gateway API key `gak_demo_workspace` stored as prefix + hash only
- policy rules `pol_demo_budget_deny_premium_openai`, `pol_demo_balanced_prefer_anthropic`
- model catalog entries:
  - `openai/gpt-5.2`
  - `openai/gpt-5-mini`
  - `openai/gpt-5-nano`
  - `anthropic/claude-opus-4-1-20250805`
  - `anthropic/claude-sonnet-4-20250514`
  - `anthropic/claude-3-5-haiku-20241022`

Allowed:

- Drizzle schema, DB connection factory, migration config, migration/seed entrypoints
- shared runtime/admin services exported by `src/index.ts`

Not allowed:

- HTTP handlers
- Provider adapters
- Routing, policy, or direct env parsing outside `@neuralayer/config`
