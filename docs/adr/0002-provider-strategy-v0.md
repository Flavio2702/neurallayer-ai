# ADR 0002 - Provider Strategy v0

> Categoria: `reference/v0`
> Stato: `historical baseline`
> Questo ADR fissa la strategia provider iniziale del prodotto.
> Per lo stato implementato oggi usare [`../current-state.md`](../current-state.md).

## Contesto

La baseline iniziale non doveva massimizzare la copertura provider.

Doveva dimostrare in modo credibile:

- vendor neutrality
- explainability del routing
- controllo costi e audit
- setup BYOK realistico per i primi partner

## Decisione

Per la v0 i provider iniziali sono:

- `openai`
- `anthropic`

Questa scelta resta il perimetro corretto del wedge iniziale.

## Principi bloccati

### 1. Due provider bastano per mostrare vendor neutrality

OpenAI e Anthropic sono sufficienti per dimostrare selezione provider, explainability e confronto costi senza moltiplicare troppo presto adapter, catalogo e testing.

### 2. BYOK prima di billing managed

La configurazione provider parte da credenziali del workspace. NeuralLayer governa routing, request path, audit e visibilita, ma non entra nel billing fully-managed.

### 3. Contratto adapter condiviso

Le integrazioni provider devono appoggiarsi a un contratto comune e provider-agnostico, cosi il gateway non dipende direttamente da SDK o shape proprietarie.

### 4. Benchmark-informed, non benchmark-live nel request path

Il routing puo usare benchmark esterni sincronizzati localmente, ma il request path sincrono non deve dipendere da fetch live.

## Fuori scope della v0

- terzo provider
- streaming
- fallback e retry automatici tra provider
- astrazione perfetta di ogni feature provider-specifica
- logiche di selezione opaque o ML-driven come prerequisito

## Conseguenze pratiche nel repo attuale

- `@neuralayer/provider-adapters` espone adapter reali non-streaming per OpenAI e Anthropic
- il gateway continua a supportare solo il path `chat/completions` non-streaming
- il catalogo modelli iniziale e il sync benchmark restano coerenti con il perimetro a due provider
- il control plane Sprint 2/3 espone guardrail e setup guidato solo per questi due provider
