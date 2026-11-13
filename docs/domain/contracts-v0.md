# Domain Contracts v0

> Categoria: `reference/v0`
> Stato: `current reference`
> Questo documento riassume il vocabolario condiviso del dominio.
> Per i tipi esatti esportati usare `packages/core/src`.

## Scope

`@neuralayer/core` e il boundary condiviso tra:

- gateway
- admin
- servizi DB
- provider adapters

Il package contiene enum, DTO e contratti runtime provider-agnostici.

## Principi

- vendor-neutral
- metadata-first
- explainable
- coerente tra HTTP, runtime e persistence

## Enum canonici

Valori bloccati oggi:

- `ProviderName`: `openai`, `anthropic`
- `Mode`: `max_quality`, `balanced`, `budget`
- `TaskType`: `general`, `code_generation`, `code_review`, `debugging`, `documentation`
- `RequestSource`: `api`, `cli`, `vscode_extension`, `dashboard`, `unknown`
- `PolicyDecisionType`: `allow`, `warn`, `block`
- `PolicyEnforcementMode`: `hard_block`, `soft_warn`
- `RequestStatus`: `pending`, `running`, `succeeded`, `failed`, `blocked`
- `AttemptStatus`: `pending`, `running`, `succeeded`, `failed`, `timeout`, `blocked`
- `ErrorType`: `auth_error`, `forbidden`, `invalid_request`, `policy_blocked`, `rate_limit`, `quota_exceeded`, `provider_unavailable`, `timeout`, `not_supported`, `internal_error`
- `AuditActorType`: `system`, `user`, `api_key`

## Contratti condivisi principali

### Request normalization

- `Message`
- `NormalizedRequest`
- `ResolvedContext`

`NormalizedRequest` rappresenta la request pronta per routing ed execution:

- `stream` resta `false` nel path v0 supportato
- `messages` contiene il payload normalizzato
- `mode`, `taskType`, `projectId`, `metadata` restano opzionali solo finche non vengono risolti nel contesto effettivo

`ResolvedContext` rappresenta invece il contesto runtime minimo gia deciso:

- `workspaceId`
- `projectId`
- `mode`
- `source`
- `requestId`
- `apiKeyId`
- `taskType`

### Routing

- `PolicyDecision`
- `ProviderCandidate`
- `SelectedRoutingDecision`
- `BlockedRoutingDecision`
- `RoutingDecision`

`RoutingDecision` e oggi una union discriminata:

- `outcome: "selected"`
- `outcome: "blocked"`

Il caso `selected` espone almeno:

- `selected`
- `selectionReasonCode`
- `selectionReasonText`
- `alternatives?`
- `policyDecisions?`
- `warnings?`

Il caso `blocked` mantiene la stessa explainability breve senza un provider selezionato.

### Provider execution

- `ProviderExecutionRequest`
- `ProviderExecutionResult`
- `NormalizedProviderError`
- `UsageRecord`

Questi contratti permettono agli adapter di restare provider-agnostici lato gateway.

### Public gateway responses

- `GatewaySuccessResponse`
- `GatewayErrorResponse`

Il contratto pubblico espone solo metadata compatti e safe:

- provider
- model
- usage
- selection reason
- warnings
- cost quando disponibile

## Invarianti da tenere fermi

- i contratti condivisi non devono importare dalle app
- `@neuralayer/core` non contiene env parsing, schema DB o SDK provider
- le shape pubbliche devono restare leggibili e compatte
- prompt, response body e secret non fanno parte del contratto metadata-first normale

## Source of truth

- riferimento umano: questo documento
- riferimento tecnico effettivo: `packages/core/src/enums.ts` e `packages/core/src/contracts/**`
- stato operativo corrente: [`../current-state.md`](../current-state.md)
