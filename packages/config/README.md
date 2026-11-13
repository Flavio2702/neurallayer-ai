# @neuralayer/config

Central source of truth for runtime env parsing and shared typed config.

Current public API:

- `parseRuntimeEnv(env?: NodeJS.ProcessEnv)`
- `loadGatewayConfig(env?: NodeJS.ProcessEnv)`
- `loadAdminConfig(env?: NodeJS.ProcessEnv)`
- `loadDatabaseConfig(env?: NodeJS.ProcessEnv)`
- `loadAdminAccessGateConfig(env?: NodeJS.ProcessEnv)`
- `loadAdminSessionConfig(env?: NodeJS.ProcessEnv)`
- `loadProviderCredentialsConfig(env?: NodeJS.ProcessEnv)`

Supported env:

- `NODE_ENV`
- `LOG_LEVEL`
- `DATABASE_URL`
- `GATEWAY_HOST`
- `GATEWAY_PORT`
- `ADMIN_PORT`
- `ADMIN_WORKSPACE_ID`
- `ADMIN_SMOKE_WORKSPACE_ID`
- `ADMIN_ACCESS_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `PROVIDER_CREDENTIALS_SECRET`
- `NEXT_PUBLIC_GATEWAY_URL`
- `ARTIFICIAL_ANALYSIS_API_KEY`

Current admin-specific config:

- `loadAdminConfig()` exposes `admin.port`, optional `admin.workspaceId`, optional `admin.smokeWorkspaceId`, and `public.gatewayUrl`.

Current consumers:

- `apps/admin`
- `apps/gateway`
- `apps/admin/scripts/run-next.mjs`
- `packages/db`

Operational notes:

- `loadAdminConfig()` exposes optional `admin.workspaceId` and `admin.smokeWorkspaceId` for normal-vs-smoke workspace targeting
- `apps/admin/scripts/run-next.mjs` loads the repo-root `.env` when present and still fails fast with readable errors if `ADMIN_ACCESS_PASSWORD` or `ADMIN_SESSION_SECRET` are missing
- `ARTIFICIAL_ANALYSIS_API_KEY` is optional and only needed for live benchmark fetch or sync
- `PROVIDER_CREDENTIALS_SECRET` is required only for the dedicated provider-credentials loader path, not for every bootstrap path

Allowed:

- Zod env schema
- Typed config loaders for gateway, admin, and DB tooling
- Readable env validation errors and context-specific required-secret loaders

Not allowed:

- Domain contracts
- Database schema
- Provider code or app bootstrap logic
