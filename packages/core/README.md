# @neuralayer/core

Shared domain contracts and enums used by gateway, admin, DB services, and provider adapters.

Current scope:

- provider-agnostic enums such as `ProviderName`, `Mode`, `TaskType`, `RequestStatus`, and `ErrorType`
- shared contracts for requests, routing, providers, usage, audit, and gateway responses
- the public runtime vocabulary that keeps apps and packages aligned

Important references:

- `src/enums.ts`
- `src/contracts/gateway.ts`
- `src/contracts/requests.ts`
- `src/contracts/routing.ts`

Allowed:

- provider-agnostic domain types and DTOs
- stable shared enum vocabularies
- public response and error shapes used across packages

Not allowed:

- env/config parsing
- database schema or queries
- provider SDK code
- HTTP/framework bootstrap logic
