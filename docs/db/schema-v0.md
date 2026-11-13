# Database Schema v0

> Categoria: `reference/v0`
> Stato: `current reference`
> Questo documento riassume il modello dati e i boundary DB condivisi del repo.
> Per lo stato implementato usare `packages/db/src/schema/**`, `packages/db/src/index.ts` e [`../current-state.md`](../current-state.md).

## Obiettivo

La persistence v0 deve supportare:

- request path runtime metadata-first
- setup guidato del control plane
- auditabilita e cost visibility
- benchmark-informed routing senza fetch live nel request path

## Tabelle principali

### Workspace e accesso

- `workspaces`
- `users`
- `memberships`

Queste tabelle mantengono il perimetro single-workspace oriented del prodotto senza rinunciare a un dominio workspace-scoped coerente.

### Configurazione operativa

- `projects`
- `gateway_api_keys`
- `provider_accounts`
- `routing_profiles`
- `policy_rules`

Note operative:

- `gateway_api_keys` supporta key `workspace-scoped` legacy e key `project-scoped`
- il path UI normale genera solo key `project-scoped`
- `provider_accounts.encrypted_credentials` e il boundary di storage delle credenziali provider
- `policy_rules` resta la fonte di verita sia per il router sia per i guardrail minimali esposti dall'admin

### Catalogo e benchmark

- `model_catalog`
- `external_model_benchmarks`

Il gateway usa benchmark locali gia sincronizzati; non dipende da chiamate live nel request path.

### Runtime lineage

- `requests`
- `request_attempts`
- `usage_records`
- `audit_events`

Questa separazione resta un vincolo esplicito:

- `requests` = unit of work logica
- `request_attempts` = singoli tentativi provider
- `usage_records` = usage e costo
- `audit_events` = eventi runtime e control-plane append-only

## Invarianti di schema

### Metadata-first

- `requests.normalized_request_json` salva un envelope redatto
- prompt e response body completi non vengono persistiti di default
- `audit_events` e `usage_records` restano leggibili senza dump raw del payload

### Credenziali provider

- le credential provider salvate dall'admin vengono cifrate applicativamente
- il decrypt vive solo nei path necessari di runtime execution e provider connection test
- le shape admin espongono solo preview masked e metadata safe

### Key lifecycle

- le nuove key create dal control plane nascono `project-scoped`
- il DB salva solo `key_prefix` e `key_hash`
- il raw value viene restituito solo al momento della creazione

### Guardrails

`policy_rules` viene riusata per i guardrail attuali:

- `budget_cap` workspace-level
- `preferred_provider` project-level
- `allow_provider` project-level

Il repo non introduce una modellazione separata di settings o una console `Policies` generalista.

## Servizi DB condivisi oggi

`@neuralayer/db` non espone solo schema e seed. Espone anche i servizi usati dalle app.

### Lifecycle e setup

- `listProjects`
- `getProjectBySlug`
- `createProject`
- `renameProject`
- `updateProjectSlug`
- `activateProject`
- `deactivateProject`
- `createProjectGatewayApiKey`
- `listProjectGatewayApiKeys`
- `revokeProjectGatewayApiKey`
- `getWorkspaceBudgetCap`
- `upsertWorkspaceBudgetCap`
- `upsertProjectPreferredProvider`
- `upsertProjectAllowedProviders`
- `getProjectGuardrailsForAdmin`
- `testWorkspaceProviderConnection`

### Read model admin

- `getRequestsPageData`
- `getWorkspaceSetupProgress`
- `getTrialSummary`
- `getRequestsCsvExport`
- `getAuditCsvExport`
- `upsertManualRequestFeedback`
- `getLatestManualRequestFeedback`

### Runtime support

- `listModelCatalog`
- `listActiveWorkspaceProviderAccounts`
- `resolveProviderAccountExecutionConfig`
- `recordProviderAccountOperationalOutcome`
- `listLatestStrictExternalBenchmarks`
- altri helper di routing e pricing esportati via `runtime-routing-service`

## Seed e flusso locale

Flusso canonico:

```powershell
corepack pnpm db:start
corepack pnpm db:migrate
corepack pnpm db:seed
```

Il seed prepara `ws_demo`, `proj_demo`, provider demo/placeholder controllati, catalogo modelli iniziale e una demo gateway key locale.

## Source of truth

- schema Drizzle: `packages/db/src/schema/**`
- public surface del package: `packages/db/src/index.ts`
- sintesi operativa: [`../current-state.md`](../current-state.md)
