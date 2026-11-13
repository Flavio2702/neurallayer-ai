# NeuralLayer AI

[![CI](https://github.com/Flavio2702/neurallayer-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Flavio2702/neurallayer-ai/actions/workflows/ci.yml)

**Un gateway LLM per rendere la scelta del modello esplicita, configurabile e comprensibile.**

> **Progetto in sviluppo — MVP sperimentale.** Il prodotto non è finito né certificato per la produzione. I test pubblici usano provider simulati: non dimostrano qualità delle risposte, risparmio economico o compatibilità attuale con ogni modello esterno.

## Il problema

Quando un'applicazione usa più modelli, scegliere sempre lo stesso può ignorare esigenze diverse di qualità, costo e velocità. NeuralLayer esplora un punto di accesso comune che combina preferenze dell'utente, vincoli del progetto e informazioni sui modelli, rendendo visibile il motivo della scelta.

Il progetto unisce un'API, un motore di selezione e un pannello operativo: dal collegamento del provider alla lettura di richieste, consumi e decisioni. È un lavoro di portfolio su integrazione di servizi, contratti API, gestione delle credenziali e verificabilità del comportamento.

## Come sceglie il modello oggi

1. Il client invia i messaggi, una modalità (`max_quality`, `balanced` o `budget`) e facoltativamente un tipo di attività (`general`, `code_generation`, `code_review`, `debugging`, `documentation`). **Il tipo di attività è dichiarato dal client, non dedotto dal prompt.**
2. Il gateway autentica la chiave e risolve workspace e progetto. Carica dal database provider configurati, catalogo e policy applicabili.
3. Esclude i candidati vietati e controlla il budget registrato. Calcola un punteggio per i candidati rimasti combinando qualità, costo e prestazioni.
4. Usa snapshot locali di Artificial Analysis quando disponibili. Se mancano segnali usa classi indicative del catalogo; segnala dati mancanti o datati. Non scarica benchmark durante la richiesta.
5. Sceglie un candidato con spareggi deterministici e restituisce informazioni sulla decisione. Inoltra una chiamata testuale non streaming al provider scelto e registra metadati, esito, usage e costo quando calcolabile.

I pesi nel [router](apps/gateway/src/modules/chat/router.ts) sono scelte progettuali:

| Modalità      | Qualità | Costo | Prestazioni |
| ------------- | ------: | ----: | ----------: |
| `max_quality` |     70% |   10% |         20% |
| `balanced`    |     45% |   30% |         25% |
| `budget`      |     25% |   50% |         25% |

Il ranking è un'euristica: un benchmark generale non garantisce la risposta migliore per una richiesta specifica. Le alternative nel risultato spiegano il ranking; non equivalgono a un failover automatico tra provider.

## Disponibile nel codice

- Gateway Fastify: `GET /health`, `GET /v1/me`, `GET /v1/models`, `POST /v1/chat/completions`.
- Adapter HTTP OpenAI Chat Completions e Anthropic Messages, con timeout e normalizzazione di risposte ed errori.
- Routing con policy su provider/modelli, preferenza provider, modalità e controllo del budget contabilizzato.
- Pannello Next.js protetto da password condivisa: Providers, Projects, chiavi di progetto, Playground a richiesta singola, Requests, Trial summary ed export CSV.
- PostgreSQL con migrazioni Drizzle, catalogo iniziale e seed dimostrativo.
- Hash delle chiavi gateway; nuove credenziali provider cifrate con AES-256-GCM e scrypt. I vecchi record in chiaro restano leggibili: vanno risalvati per cifrarli.
- Persistenza con riepiloghi redatti, senza salvare normalmente il testo di prompt e risposte nel feed operativo. I messaggi vengono comunque inviati al provider selezionato.
- Import manuale o sincronizzazione su comando dei benchmark; test con simulazioni e integrazioni su database.

## In sviluppo e limiti noti

- Mancano streaming, tool calling avanzato, embeddings, immagini/audio e batch.
- L'amministrazione resta orientata a un workspace. Auth SaaS completa, utenti multipli, RBAC/SSO e fatturazione gestita sono fuori dal perimetro attuale.
- Non sono disponibili un editor generale di policy/profili, un terzo provider o una sincronizzazione benchmark pianificata incorporata.
- Mancano valutazioni comparative delle risposte, prove di carico e validazione dei benefici economici. Non vengono promessi prestazioni o risparmi.
- Catalogo e prezzi iniziali possono invecchiare. Verificare disponibilità, autorizzazioni e prezzi prima dell'uso reale. Il costo interno può essere stimato o non disponibile e non sostituisce la fattura del provider.
- Il budget usa la spesa già registrata: non prenota atomicamente il costo di richieste concorrenti e non garantisce un tetto esatto sulla fatturazione esterna.
- Il seed crea una chiave gateway dimostrativa pubblicamente nota e provider senza credenziali reali: serve solo per sviluppo locale. Non esporre l'ambiente demo a Internet.
- Il Playground può conservare la chiave nel tab tramite `sessionStorage` quando l'opzione è attiva. Usarlo su un dispositivo fidato. Non inserire dati riservati in note e metadati.

Priorità future: validare il comportamento con provider reali e attività rappresentative, mantenere aggiornati catalogo e pricing, consolidare la sicurezza operativa. Sono obiettivi, non funzionalità completate.

## Requisiti e installazione

- Node.js **24 LTS**, versione principale usata per le verifiche.
- Corepack e pnpm **10.34.9**, fissato in `package.json`. Se Corepack manca, seguire la [guida pnpm](https://pnpm.io/installation).
- Docker con Docker Compose per PostgreSQL 16, oppure un PostgreSQL 16 dedicato.
- Chromium/Edge locale per gli smoke test del pannello.

```sh
git clone https://github.com/Flavio2702/neurallayer-ai.git
cd neurallayer-ai
corepack pnpm install --frozen-lockfile
```

## Configurazione locale

Copia `.env.example` in `.env`: `cp .env.example .env` su macOS/Linux oppure `Copy-Item .env.example .env` in PowerShell. Sostituisci tutti i valori `CHANGE_ME`:

| Variabile                                    | Configurazione                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`, `DATABASE_URL`          | Stessa password scelta per il DB; usare valori adatti a un URL o codificarli. Se cambi porta/utente/database, aggiorna anche l'URL. |
| `ADMIN_ACCESS_PASSWORD`                      | Password privata per il pannello.                                                                                                   |
| `ADMIN_SESSION_SECRET`                       | Segreto casuale per firmare le sessioni.                                                                                            |
| `PROVIDER_CREDENTIALS_SECRET`                | Altro segreto casuale per cifrare le credenziali. Conservarlo: cambiarlo rende illeggibili quelle già cifrate.                      |
| `GATEWAY_HOST`, `GATEWAY_PORT`, `ADMIN_PORT` | Indirizzi e porte locali; il gateway di esempio ascolta su loopback.                                                                |
| `NEXT_PUBLIC_GATEWAY_URL`                    | URL del gateway, da aggiornare se cambia la porta.                                                                                  |
| `ADMIN_WORKSPACE_ID`                         | Vuoto per il workspace demo; altrimenti ID di un workspace già presente nel DB.                                                     |
| `ARTIFICIAL_ANALYSIS_API_KEY`                | Opzionale, solo per scaricare benchmark live.                                                                                       |

Per generare un segreto locale: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Genera valori distinti e copiali solo nel tuo `.env`. Lascia vuota `ADMIN_SMOKE_WORKSPACE_ID`, riservata ai test.

Le chiavi OpenAI/Anthropic si configurano dalla pagina **Providers**, dopo l'accesso. Non servono per compilazione e test simulati. `.env`, database, log e cartelle generate sono esclusi da Git.

## Preparazione e avvio

```sh
corepack pnpm build
corepack pnpm db:start
corepack pnpm db:migrate
corepack pnpm db:seed
```

Il seed popola workspace e progetto demo con dati sintetici e mostra una chiave gateway solo dimostrativa. Non configura credenziali provider funzionanti. I comandi DB, gateway e admin caricano il `.env` della root.

In due terminali separati:

```sh
corepack pnpm --filter @neuralayer/gateway start
```

```sh
corepack pnpm --filter @neuralayer/admin start
```

Apri [il pannello locale](http://localhost:3000) e accedi con `ADMIN_ACCESS_PASSWORD`. Per il percorso reale: configura un provider, esegui il test di connessione, crea un progetto e una chiave, invia una richiesta dal Playground e consulta Requests. **Test di connessione e richieste reali possono generare costi.**

Liveness: `curl http://127.0.0.1:4000/health`. Non verifica da sola disponibilità del DB o di un provider. Per sviluppo: `corepack pnpm dev`. Arresto DB: `corepack pnpm db:stop` (il volume viene conservato).

Payload senza credenziali da inviare a `POST /v1/chat/completions`, con header `Authorization: Bearer <GATEWAY_API_KEY>`:

```json
{
  "project_id": "<PROJECT_ID>",
  "mode": "balanced",
  "task_type": "documentation",
  "stream": false,
  "messages": [
    {
      "role": "user",
      "content": "Spiega in poche righe che cosa fa un gateway API."
    }
  ]
}
```

Vedi [Gateway API v0](docs/api/gateway-v0.md). Non è promessa compatibilità completa con gli SDK OpenAI.

## Test ripetibili

Usa **un database dedicato ai test**, mai uno di produzione. Con `.env` configurato, DB avviato, migrazioni/seed applicati e build completata:

```sh
corepack pnpm lint
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm test
```

Il comando `test` carica `.env`, usa un segreto sintetico per le fixture e lancia le suite in sequenza: alcuni test condividono dati benchmark. Le suite DB possono saltare test se il database non è raggiungibile: un riepilogo senza errori ma con test saltati non prova l'integrazione.

Per il percorso completo del pannello con provider locale simulato:

```sh
corepack pnpm admin:smoke:self-serve
```

Richiede Chromium/Edge e usa workspace temporanei. Se il browser rilevato non si avvia, impostare `ADMIN_SMOKE_BROWSER` con il percorso del proprio eseguibile Chromium/Chrome/Edge. Sono disponibili anche `admin:smoke:overview`, `admin:smoke:projects` e `admin:smoke:trial-summary`. La CI esegue build, controlli statici e suite con PostgreSQL, senza chiavi LLM. Gli [esiti della verifica](docs/publication-checks.md) distinguono prove eseguite e limiti.

## Servizi esterni e costi

OpenAI e Anthropic ricevono i messaggi delle richieste reali e fatturano secondo account e modello. Consultare [OpenAI API](https://developers.openai.com/api/docs/guides/production-best-practices) e [Anthropic Messages](https://platform.claude.com/docs/en/api/messages): disponibilità e condizioni possono cambiare. Il gateway non include credito API.

Artificial Analysis è opzionale: l'accesso live può richiedere un piano/API key con proprie condizioni. Import da file autorizzato: `corepack pnpm --filter @neuralayer/db benchmark:sync --input <payload.json>`. Il repository non distribuisce un dataset commerciale. Hosting, database e Docker possono avere costi o condizioni propri.

## Architettura e documentazione

```text
Client / Playground → Gateway Fastify → Policy e ranking → OpenAI / Anthropic
                            ↕
                       PostgreSQL ← Import benchmark su comando
                            ↕
                       Pannello Next.js
```

- `apps/gateway`: autenticazione, contratti HTTP, routing ed esecuzione.
- `apps/admin`: configurazione e lettura operativa.
- `packages/core`, `config`, `db`, `provider-adapters`: contratti e servizi condivisi.
- [Documentazione](docs/README.md) e [stato di sviluppo](docs/current-state.md).

## Licenza e contributi

Codice e contributi originali sono distribuiti con **[Apache-2.0](LICENSE)**. Le dipendenze mantengono le proprie licenze e attribuzioni: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). La licenza del codice non concede diritti su servizi, marchi o dati di terzi.

Segnalazioni e contributi sono benvenuti: descrivere il problema, i passaggi per riprodurlo e le verifiche, usando dati sintetici. I contributi destinati al progetto sono proposti sotto Apache-2.0. Non allegare `.env`, chiavi, prompt privati o dump del database.
