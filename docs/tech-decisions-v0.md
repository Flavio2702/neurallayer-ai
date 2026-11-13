# Tech Decisions v0

> Categoria: `reference/v0`
> Stato: `historical baseline`
> Questo file e un riassunto umano delle decisioni v0.
> Non descrive da solo lo stato operativo corrente: usare [`./current-state.md`](./current-state.md).

## Documenti sorgente

- [`adr/0001_mvp_architettura.md`](./adr/0001_mvp_architettura.md)
- [`adr/0002-provider-strategy-v0.md`](./adr/0002-provider-strategy-v0.md)
- [`adr/0003-external-benchmark-informed-routing-v0.md`](./adr/0003-external-benchmark-informed-routing-v0.md)
- [`api/gateway-v0.md`](./api/gateway-v0.md)
- [`db/schema-v0.md`](./db/schema-v0.md)
- [`domain/contracts-v0.md`](./domain/contracts-v0.md)

## Decisioni sintetiche

- il prodotto resta un layer di governance explainable per richieste LLM multi-provider
- il repo resta un monorepo TypeScript con gateway, admin e package condivisi
- il wedge iniziale privilegia BYOK, metadata-first e operabilita leggibile
- il runtime resta rule-based e benchmark-informed, non black-box
- i provider iniziali bloccati sono `openai` e `anthropic`

## Stack congelato a livello v0

- Monorepo: `pnpm` + `Turborepo`
- Linguaggio: `TypeScript`
- Gateway: `Node.js` + `Fastify` + `Zod`
- Admin: `Next.js` + `React` + `Tailwind`
- Database: `Postgres`
- ORM/migrations: `Drizzle`
- Local dev: `Docker Compose`

## Vincoli di prodotto da tenere fermi

- niente streaming nel path v0 corrente
- niente billing managed
- niente terzo provider
- niente analytics o reporting avanzati come prerequisito
- niente full payload retention come default

## Come leggere questa sezione oggi

- per il quadro reale del repo: [`current-state.md`](./current-state.md)
- per il contratto pubblico del gateway: [`api/gateway-v0.md`](./api/gateway-v0.md)
- per schema e servizi DB condivisi: [`db/schema-v0.md`](./db/schema-v0.md)
- per i documenti di verifica che chiudono Sprint 2 e Sprint 3:
