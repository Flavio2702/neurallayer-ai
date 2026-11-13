# Stato di sviluppo

NeuralLayer AI è un MVP sperimentale in sviluppo. Il [README](../README.md) descrive il perimetro pubblico e le istruzioni ripetibili; il [rapporto di verifica](publication-checks.md) riporta soltanto i controlli osservati per questa pubblicazione.

Il percorso implementato è: configurazione provider → progetto → chiave → richiesta testuale non streaming → decisione di routing → esecuzione provider → metadati in Requests. Sono presenti anche budget workspace, guardrail progetto, riepiloghi e CSV.

Il router combina segnali benchmark locali e classi indicative del catalogo con pesi espliciti per modalità. La categoria del lavoro è dichiarata dal client. La motivazione della scelta è esposta, ma non prova che la risposta sarà migliore. Il catalogo iniziale non rappresenta una lista aggiornata automaticamente dei modelli disponibili.

I test simulano servizi LLM e usano dati sintetici. Non sono state effettuate chiamate a pagamento per la pubblicazione. Non sono verificati prestazioni sotto carico, qualità delle risposte, risparmi, disponibilità attuale di ogni modello o recupero da incidenti in produzione.

Restano fuori dal perimetro streaming, tool calling avanzato, immagini/audio, embeddings, batch, auth SaaS multiutente, SSO/RBAC, billing gestito, terzo provider ed editor generale delle policy. L'evoluzione richiede validazione reale e ulteriore consolidamento operativo.

I documenti ADR e di riferimento v0 conservati spiegano le decisioni e i contratti iniziali. Le sezioni formulate al futuro sono intenzioni di progetto e non attestazioni di implementazione. In caso di differenze, fare riferimento al codice corrente e al README.
