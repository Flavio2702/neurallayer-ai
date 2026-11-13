# ADR 0001 - Architettura MVP NeuralLayer AI

> Categoria: `reference/v0`
> Stato: `historical baseline`
> Questo ADR descrive la baseline architetturale approvata all'inizio del repo.
> Per lo stato operativo reale usare prima [`../current-state.md`](../current-state.md).

## Contesto

NeuralLayer AI nasce come layer di governance per richieste LLM multi-provider.

La decisione iniziale doveva bloccare poche cose durevoli:

- mantenere il prodotto explainable e metadata-first
- validare il wedge con un monorepo semplice, non con microservizi
- separare chiaramente data plane e control plane
- usare pacchetti condivisi per evitare drift tra gateway, admin e persistence

## Decisione

L'MVP viene costruito come un solo monorepo TypeScript con due superfici logiche principali e un set piccolo di package condivisi:

- `apps/gateway`: data plane HTTP per auth, catalogo modelli e `chat/completions`
- `apps/admin`: control plane server-rendered per setup guidato e operabilita
- `packages/core`: contratti di dominio ed enum condivisi
- `packages/db`: schema Drizzle, servizi DB e read/write model condivisi
- `packages/provider-adapters`: adapter provider-agnostici e registry
- `packages/config`: env parsing e loader tipizzati

## Principi architetturali bloccati

### 1. Monorepo prima di distribuzione complessa

La separazione tra gateway e admin e logica, non infrastrutturale. La priorita v0 e velocita con boundary chiari, non isolamento deploy-prematuro.

### 2. BYOK e metadata-first

Il prodotto governa routing, budget, audit e visibilita; non gestisce billing fully-managed nel wedge iniziale.

Di default il sistema persiste metadata operativi, usage, costi, routing e audit, non prompt/response body completi.

### 3. Multi-tenant leggero

`workspace_id` resta la chiave di primo livello del dominio e della persistence, ma senza introdurre da subito superfici enterprise o multi-workspace UX.

### 4. Routing e policy explainable

Routing e guardrail devono restare leggibili e difendibili:

- rule-based
- metadata-backed
- auditabili
- senza black box o decisioni opache come prerequisito del prodotto

### 5. Shared packages come boundary reali

I contratti che devono restare coerenti tra le superfici vivono nei package condivisi, non copiati dentro le app.

## Conseguenze pratiche

- il gateway tiene route sottili e delega la logica applicativa a runtime ed executor dedicati
- l'admin legge e scrive stato reale via servizi DB condivisi, non con query sparse nelle pagine
- i contratti pubblici e interni si appoggiano a `@neuralayer/core`
- la configurazione runtime resta centralizzata in `@neuralayer/config`
- l'eventuale evoluzione futura verso deploy piu separati resta possibile senza cambiare i boundary logici gia fissati

## Note di allineamento con il repo attuale

- le capability di routing, policy e persistence sono oggi implementate soprattutto tra `apps/gateway` e `packages/db`, non come package runtime separati
- `apps/admin` e una superficie interna, minima e DB-backed, ma non piu una shell statica
