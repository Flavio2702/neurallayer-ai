# @neuralayer/provider-adapters

Shared non-streaming provider adapter layer for the gateway runtime.

Current status:

- provider registry and adapter contracts are implemented
- OpenAI and Anthropic adapters are real on the shared non-streaming contract
- `createProviderConnectionTestRunner()` reuses the same adapter execution path for explicit provider connection tests
- bootstrap helpers expose `createBootstrapProviderRegistry()`, `getProviderAdapter()`, and `listBootstrapProviderNames()`

Current capabilities:

- `byok: true`
- `streaming: false`

Allowed:

- adapter interfaces and provider registry
- provider request building, invocation, normalization, and usage extraction
- shared runner logic for provider connection tests

Not allowed:

- database access
- runtime env loading
- routing or policy business logic
- HTTP/framework bootstrap
