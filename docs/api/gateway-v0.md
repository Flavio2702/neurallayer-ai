# Gateway API v0

> Categoria: `reference/v0`
> Stato: `current reference`
> Questo documento descrive il contratto pubblico v0 del gateway.

## Scope

Il gateway v0 resta focalizzato su quattro endpoint:

- `GET /health`
- `GET /v1/me`
- `GET /v1/models`
- `POST /v1/chat/completions`

Non copre streaming, tool calling avanzato, embeddings, image/audio, batch o admin API dedicate.

## Auth model

- `GET /health` non richiede auth
- tutte le route sotto `/v1` richiedono `Authorization: Bearer <gateway-api-key>`
- il path UI normale espone solo key `project-scoped`
- il gateway resta compatibile anche con key `workspace-scoped` legacy gia presenti nel DB

Quando la request non porta un progetto valido e l'auth context non puo risolvere un `defaultProjectId`, il gateway risponde con `missing_project_id`.

## Endpoints

### `GET /health`

Endpoint pubblico di liveness minimale.

Response:

```json
{
  "status": "ok",
  "service": "gateway",
  "version": "v1"
}
```

### `GET /v1/me`

Restituisce il contesto base della key autenticata.

Response shape:

```json
{
  "workspace": {
    "id": "ws_demo",
    "name": "Demo Workspace"
  },
  "project": {
    "id": "proj_demo",
    "name": "Demo Project"
  },
  "available_modes": ["max_quality", "balanced", "budget"],
  "available_task_types": [
    "general",
    "code_generation",
    "code_review",
    "debugging",
    "documentation"
  ],
  "providers_configured": ["openai", "anthropic"]
}
```

`project` puo essere `null` quando la key non porta un progetto di default.

### `GET /v1/models`

Restituisce il catalogo modelli visibile al gateway.

Query supportate:

- `provider`
- `mode`
- `task_type`

Response shape:

```json
{
  "data": [
    {
      "id": "mc_openai_gpt_5_mini",
      "provider": "openai",
      "model_id": "gpt-5-mini",
      "label": "OpenAI GPT-5 Mini",
      "capability_class": ["general", "reasoning"],
      "cost_tier": "low",
      "latency_tier": "fast",
      "supports_chat": true,
      "supports_streaming": false,
      "is_active": true
    }
  ]
}
```

### `POST /v1/chat/completions`

Path operativo principale del prodotto.

Body JSON:

```json
{
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Explain the latest error." }
  ],
  "mode": "balanced",
  "task_type": "debugging",
  "project_id": "proj_demo",
  "stream": false,
  "metadata": {
    "ticket": "INC-123"
  }
}
```

Headers opzionali supportati:

- `x-neuralayer-project-id`
- `x-neuralayer-mode`
- `x-neuralayer-task-type`

Precedence:

- i valori nel body vincono sugli header
- `mode` defaulta a `balanced`
- `task_type` defaulta a `general`
- `stream` defaulta a `false`

`messages` e obbligatorio e deve contenere almeno un messaggio.

## Success response

Il contratto pubblico compatto vive in `@neuralayer/core` come `GatewaySuccessResponse`.

Shape:

```json
{
  "id": "req_123",
  "object": "chat.completion",
  "created": 1774016400,
  "model": "gpt-5-mini",
  "provider": "openai",
  "mode": "balanced",
  "task_type": "debugging",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Structured runtime response."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "input_tokens": 12,
    "output_tokens": 8,
    "total_tokens": 20
  },
  "meta": {
    "workspace_id": "ws_demo",
    "project_id": "proj_demo",
    "latency_ms": 22,
    "selection_reason": {
      "code": "best_score_for_mode",
      "text": "Selected openai/gpt-5-mini because it had the best budget score across policy-eligible candidates."
    },
    "warnings": [
      {
        "code": "benchmark_snapshot_stale",
        "message": "The latest local benchmark snapshot is older than 7 days, so routing continued with a staleness warning."
      }
    ],
    "cost_usd": 0.42,
    "cost_source": "estimated"
  }
}
```

Note:

- `provider` e `model` sono top-level canonici
- `meta.selection_reason` e la explainability pubblica compatta
- `meta.warnings` e opzionale
- `cost_usd` / `cost_source` compaiono solo quando il costo e disponibile
- il gateway non espone prompt o response body persistiti come parte del contratto operativo

## Error model

Il contratto pubblico d'errore vive in `@neuralayer/core` come `GatewayErrorResponse`.

Shape:

```json
{
  "error": {
    "type": "invalid_request",
    "code": "missing_project_id",
    "message": "No valid project context could be resolved for this request.",
    "request_id": "req_123"
  }
}
```

Tipi pubblici usati oggi:

- `auth_error`
- `forbidden`
- `invalid_request`
- `policy_blocked`
- `rate_limit`
- `quota_exceeded`
- `provider_unavailable`
- `timeout`
- `not_supported`
- `internal_error`

Codici pubblici rilevanti bloccati dal contratto corrente:

- `missing_authorization_header`
- `invalid_authorization_header`
- `invalid_api_key`
- `revoked_api_key`
- `expired_api_key`
- `missing_project_id`
- `invalid_mode`
- `invalid_task_type`
- `missing_messages`
- `invalid_provider`
- `streaming_not_enabled`
- `workspace_budget_exceeded`
- `policy_blocked`
- `provider_auth_failed`
- `provider_configuration_missing`
- `invalid_provider_configuration`

Semantica pubblica importante:

- i blocchi di budget vengono normalizzati a `policy_blocked` + `workspace_budget_exceeded`
- gli altri blocchi di routing diventano `policy_blocked`
- `stream=true` viene rifiutato con `not_supported` + `streaming_not_enabled`
- gli errori provider di autenticazione/configurazione restano leggibili e public-safe

## Runtime guarantees

- `POST /v1/chat/completions` usa un runtime non-streaming DB-backed
- il router e benchmark-informed ma non fa fetch benchmark live nel request path
- la persistence salva `requests`, `request_attempts`, `usage_records` e `audit_events`
- la request persiste un envelope redatto, non prompt/response body completi di default

## Source of truth

- contratto HTTP e shape pubbliche: questo documento + `@neuralayer/core`
- implementazione runtime: `apps/gateway`
- stato operativo vivo: [`../current-state.md`](../current-state.md)
