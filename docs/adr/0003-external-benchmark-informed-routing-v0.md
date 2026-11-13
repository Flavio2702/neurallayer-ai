# ADR 0003 — External Benchmark-Informed Routing v0

## Status

Accepted

## Data

2026-03-20

## Owner

Flavio / NeuralLayer AI

---

## Contesto

NeuralLayer AI vuole evitare che la scelta del modello appaia arbitraria o basata su logiche opache interne.

Per l’MVP, il prodotto deve poter dire in modo credibile:

- il routing non è una “macchinazione” proprietaria difficile da verificare

- la base di ranking viene da benchmark terzi indipendenti

- NeuralLayer aggiunge sopra questi dati:
  - policy

  - contesto workspace/progetto

  - controllo costi

  - visibilità e audit

Per questo motivo, il routing v0 utilizzerà benchmark esterni come baseline decisionale.

---

## Decisione

Per l’MVP, NeuralLayer AI userà **Artificial Analysis** come fonte esterna primaria di benchmark per informare il routing dei modelli.

### Regola chiave

Artificial Analysis **non** verrà interrogato in tempo reale dentro il path sincrono di ogni request.

Il sistema funzionerà così:

1. sincronizzazione periodica dei dati benchmark da Artificial Analysis

2. salvataggio dei dati benchmark nel database interno

3. ranking locale dei modelli eseguito da NeuralLayer

4. applicazione di policy e vincoli workspace/progetto

5. selezione finale del modello tra quelli eleggibili

---

## Perché questa decisione

### 1. Credibilità esterna

Usare benchmark di terze parti rende la logica di scelta più difendibile e più facile da raccontare commercialmente.

### 2. Robustezza operativa

Fare una chiamata esterna per ogni request del gateway aumenterebbe:

- fragilità runtime

- dipendenza da rate limit esterni

- dipendenza da disponibilità di terze parti

- variabilità non controllata

### 3. Controllo di prodotto

NeuralLayer non deve sostituirsi ai benchmark, ma nemmeno esserne schiavo.

Il prodotto deve poter combinare:

- benchmark esterni

- policy interne

- configurazione reale dei provider

- obiettivi di costo/qualità/latenza

### 4. Coerenza con la tesi di prodotto

Il moat non deve essere:

- “abbiamo inventato un benchmark”

Il moat deve essere:

- “usiamo benchmark credibili come baseline e li traduciamo in controllo operativo reale per team engineering”

---

## Ruolo di Artificial Analysis nel prodotto

Artificial Analysis è trattato come:

- **baseline esterna di ranking**

- **credibility layer**

- **sorgente periodica di metriche comparative**

Artificial Analysis **non** è trattato come:

- motore di decisione live per ogni request

- unica fonte di verità del routing

- sostituto delle policy di prodotto

- sostituto degli outcome reali del team

---

## Decisione architetturale

### Flusso approvato

1. Un job schedulato chiama la API di Artificial Analysis.

2. I dati benchmark vengono salvati in tabelle interne.

3. Il router legge benchmark già sincronizzati dal DB interno.

4. Il router costruisce uno score locale per i modelli ammessi.

5. Le policy possono bloccare o restringere il set dei candidati.

6. Il modello finale viene scelto localmente.

### Regola

Il gateway **non deve dipendere** da Artificial Analysis per rispondere in tempo reale a una richiesta utente.

---

## Fonte dati esterna scelta

La fonte esterna v0 è:

- Artificial Analysis LLM data API

### Dati di interesse per il routing v0

Il sistema potrà usare almeno queste famiglie di dati:

- intelligence benchmark

- coding benchmark

- pricing

- speed / output tokens per second

- latency / time to first token

### Regola importante

La logica di routing deve dipendere da **campi mappati internamente**, non dai nomi raw della sorgente sparsi nel codice.

---

## Sincronizzazione dati

### Modalità approvata

Sync periodico server-side.

### Frequenza iniziale consigliata

- ogni 24 ore

### Frequenza alternativa accettabile

- ogni 12 ore se serve più reattività

### Regola

Per l’MVP non serve sync continuo.

### Motivo

I benchmark non cambiano con una frequenza tale da giustificare complessità realtime.

---

## Struttura logica del routing v0

Il routing v0 userà questi livelli:

### Livello 1 — Eligibility filter

Prima di qualsiasi ranking, il sistema elimina i modelli non eleggibili.

Un modello è eleggibile solo se:

- appartiene a un provider configurato nel workspace

- è attivo nel catalogo modelli interno

- supporta il tipo di richiesta richiesto

- non è bloccato da policy

- è compatibile con mode e profilo di routing

### Livello 2 — External benchmark-informed scoring

Tra i modelli eleggibili, il sistema calcola uno score locale basato sui benchmark sincronizzati da Artificial Analysis.

### Livello 3 — Local selection

Il router seleziona il modello con score migliore tra quelli rimasti, eventualmente rispettando preferenze di progetto o tie-breaker definiti.

---

## Decisione chiave: benchmark-informed, non benchmark-dictated

La selezione del modello **non** è una copia cieca del ranking esterno.

NeuralLayer usa i benchmark per informare la scelta, ma mantiene responsabilità su:

- applicazione policy

- contesto di progetto

- bilanciamento costo/qualità/latenza

- explainability della decisione

### Formula concettuale

**Artificial Analysis fornisce il segnale esterno.

NeuralLayer applica i vincoli operativi e produce la decisione finale.**

---

## Mode supportate e logica di scoring

Il prodotto continua a esporre all’utente tre mode:

- `max\_quality`

- `balanced`

- `budget`

Il significato di queste mode viene tradotto in pesi diversi nel ranking locale.

---

## Scoring v0 per mode

### 1. `max\_quality`

Obiettivo:

- privilegiare il modello migliore per qualità percepita del task

- tollerare costo più alto

- tollerare latenza non minima

#### Logica

Lo score privilegia fortemente metriche di qualità benchmark.

Per task di coding, danno più peso alle metriche coding-oriented.

Per task general, danno più peso alla qualità generale.

### 2. `balanced`

Obiettivo:

- trovare il miglior compromesso tra qualità, costo e velocità

#### Logica

Lo score mescola qualità, costo e latenza con pesi più bilanciati.

### 3. `budget`

Obiettivo:

- ridurre il costo mantenendo una soglia minima di qualità

#### Logica

Lo score privilegia il prezzo e poi usa qualità/velocità come filtro di sicurezza o correttivo.

---

## Logica task-aware v0

Il routing v0 può usare il `task\_type` per modificare i pesi interni.

### Task type iniziali

- `general`

- `code\_generation`

- `code\_review`

- `debugging`

- `documentation`

### Regola

Per questi task type:

- `code\_generation`

- `code\_review`

- `debugging`

si dà più peso ai benchmark coding-oriented.

Per:

- `general`

- `documentation`

si dà più peso alla qualità generale.

---

## Pesi iniziali approvati per il ranking locale

Per mantenere il sistema semplice e spiegabile, il ranking userà una formula a pesi fissi.

### `max\_quality`

- qualità: 70%

- costo: 10%

- velocità/latenza: 20%

### `balanced`

- qualità: 45%

- costo: 30%

- velocità/latenza: 25%

### `budget`

- qualità: 25%

- costo: 50%

- velocità/latenza: 25%

### Nota

Questi pesi sono v0 e potranno essere rivisti con dati reali.

---

## Segnali di qualità da usare

### Per task `general` e `documentation`

Segnale qualità principale:

- intelligence benchmark generale

### Per task `code\_generation`, `code\_review`, `debugging`

Segnale qualità principale:

- coding benchmark

- eventuali benchmark coding aggiuntivi disponibili nella sorgente sincronizzata

### Regola

Se un benchmark non è disponibile per un modello, il sistema deve usare fallback di scoring conservativi e non fallire.

---

## Segnali di costo da usare

Il costo deve essere letto dai dati pricing sincronizzati e convertito in un punteggio relativo.

### Regola

Il router non usa solo tier astratti, ma un dato economico interno derivato dalla sorgente esterna sincronizzata.

### Fallback

Se manca un dato di pricing:

- usare il `cost\_tier` del catalogo interno come fallback

- registrare il caso come incomplete benchmark data

---

## Segnali di velocità/latenza da usare

Per il componente performance usare, quando disponibili:

- output speed

- time to first token

### Regola

Per il ranking v0, la velocità è una dimensione correttiva, non la metrica dominante.

---

## Decisione sui tie-breaker

Se due modelli hanno score molto vicino, il sistema applica questo ordine di tie-break:

1. modello con costo inferiore

2. modello con provider preferito dal progetto, se presente

3. modello con latenza migliore

4. ordine deterministico stabile per evitare casualità

---

## Policy sopra il benchmark

Questa è una regola non negoziabile.

### Ordine corretto

1. catalogo attivo

2. provider configurati

3. policy

4. benchmark-informed scoring

5. selezione finale

### Conseguenza

Anche se un modello è il migliore secondo Artificial Analysis, non può essere scelto se:

- il provider non è configurato

- il modello è disattivato

- la policy lo blocca

- supera un cap operativo rilevante

---

## Explainability minima richiesta

Ogni decisione di routing deve poter produrre una spiegazione sintetica leggibile.

### Esempio concettuale

- mode: `balanced`

- task type: `code\_review`

- provider candidati ammessi: OpenAI, Anthropic

- benchmark source: Artificial Analysis sync locale

- motivo selezione: miglior score locale tra candidati eleggibili

- motivo esclusione altri: costo peggiore / policy / provider non configurato

### Regola

La decisione deve essere auditabile senza esporre formule inutilmente complesse in dashboard.

---

## Tolleranza a dati incompleti

Il sistema deve essere robusto anche se il dataset benchmark è incompleto.

### Regole v0

Se mancano dati benchmark per un modello:

- il modello può essere penalizzato nel ranking

- oppure può essere escluso da mode che richiedono qualità comparabile

- ma il sistema non deve andare in errore sistemico

### Raccomandazione

Meglio penalizzazione controllata che crash o comportamenti ambigui.

---

## Nuova entità dati richiesta

Per supportare questa ADR, il sistema deve introdurre una tabella interna dedicata ai benchmark esterni.

### Nome consigliato

- `external\_model\_benchmarks`

### Scopo

Separare il catalogo modelli interno dai dati sincronizzati da sorgenti esterne.

### Contenuto minimo previsto

- sorgente benchmark

- external model id stabile

- provider / creator

- model slug o nome

- metriche benchmark rilevanti

- pricing sincronizzato

- speed / latency sincronizzati

- `synced\_at`

- `raw\_payload` opzionale

---

## Mappatura con il catalogo modelli

La tabella benchmark deve essere collegabile al `model\_catalog` interno.

### Regola

La mappatura deve usare identificatori stabili quando disponibili.

### Motivo

Nomi e slug possono cambiare più facilmente rispetto agli ID stabili della sorgente.

---

## Dashboard implications

La dashboard MVP deve rendere leggibili almeno queste cose:

- fonte benchmark usata per il routing

- ultimo sync benchmark

- dati benchmark per modello

- modelli esclusi da policy vs modelli penalizzati da ranking

- mode e logica di priorità

### Non obiettivo

Non serve una UI analytics complessa sui benchmark nel primo sprint.

---

## Cosa resta fuori scope

Questa ADR non introduce ancora:

- routing live con chiamata esterna per request

- blending di più fonti benchmark

- benchmark weighting personalizzati per cliente

- auto-tuning dei pesi tramite outcome reali

- apprendimento automatico del router

- explainability avanzata con breakdown numerico completo in UI

- benchmark ingestion multi-source

---

## Alternative considerate

### Opzione A — Routing senza benchmark esterni

#### Vantaggi

- implementazione più semplice

- pieno controllo interno

#### Svantaggi

- rischio percezione arbitrarietà

- minore credibilità commerciale

- maggiore difficoltà a giustificare scelte modello

#### Esito

Scartata.

---

### Opzione B — Chiamare Artificial Analysis live su ogni request

#### Vantaggi

- dati sempre aggiornati

- logica apparentemente “pura”

#### Svantaggi

- dipendenza runtime esterna

- rate limit

- latenza

- disponibilità non controllata

- fragilità operativa

#### Esito

Scartata.

---

### Opzione C — Sync periodico + ranking locale + policy sopra tutto

#### Vantaggi

- migliore equilibrio tra credibilità e robustezza

- explainability sufficiente

- implementazione gestibile

- indipendenza runtime dal fornitore benchmark

#### Svantaggi

- dati non in tempo reale assoluto

- richiede una mappatura interna benchmark ↔ model catalog

#### Esito

Scelta approvata.

---

## Rischi accettati

### Rischio 1

Il benchmark esterno può non riflettere perfettamente i task reali del team.

#### Mitigazione

Trattare il benchmark come baseline, non come verità assoluta.

### Rischio 2

La sorgente esterna può cambiare campi, coverage o accesso.

#### Mitigazione

Aggiungere un layer di mapping interno e non dipendere dal payload raw nel core.

### Rischio 3

Il ranking potrebbe sembrare comunque “nostro”.

#### Mitigazione

Essere espliciti: benchmark terzo per il segnale, policy e vincoli operativi per la decisione finale.

---

## Trigger di revisione

Questa ADR va rivista se si verifica almeno una di queste condizioni:

- introduzione di outcome reali del team nel routing

- introduzione di una seconda fonte benchmark

- necessità di ranking cliente-specifico

- cambiamento rilevante nelle metriche disponibili dalla sorgente esterna

- passaggio a billing fully-managed o policy molto più sofisticate

---

## Sintesi finale

Per l’MVP, NeuralLayer AI adotterà un routing:

- informato da benchmark esterni

- basato su Artificial Analysis come baseline

- sincronizzato periodicamente

- eseguito localmente

- subordinato a policy, catalogo attivo e configurazione reale dei provider

Formula di prodotto:

- benchmark esterno per il segnale

- NeuralLayer per controllo, governance e decisione finale

Questa scelta rafforza la credibilità del router senza introdurre dipendenze runtime fragili o opacità inutile.
