# Verifiche della copia pubblica

Data: 13 novembre 2026. Ambiente locale: Windows, Node.js 24.12.0, pnpm 10.34.9, PostgreSQL 16 in un container dedicato, Chrome per lo smoke del pannello.

## Risultati osservati prima della pubblicazione

| Controllo                                              | Risultato                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installazione `--frozen-lockfile` nella copia separata | Superata                                                                                                                                                       |
| Build di tutti e sei i package/app                     | Superata                                                                                                                                                       |
| Typecheck                                              | Superato                                                                                                                                                       |
| Lint                                                   | Nessun errore; 23 avvisi non bloccanti preesistenti su stile/import/variabili e 2 segnalazioni informative                                                     |
| Controllo formattazione                                | Superato                                                                                                                                                       |
| Migrazioni e seed su DB vuoto dedicato                 | Superati                                                                                                                                                       |
| Suite config / DB / adapter / admin / gateway          | 5 + 74 + 14 + 22 + 50 = **165 test superati, 0 falliti, 0 saltati**                                                                                            |
| Avvio gateway e autenticazione demo                    | `/health` e `/v1/models` rispondono 200                                                                                                                        |
| Avvio admin e protezione accesso                       | `/login` risponde 200; pagina protetta reindirizza con 307                                                                                                     |
| `admin:smoke:self-serve` su Chrome                     | Superato: accesso, provider simulato, progetto, chiave, Playground, prima richiesta e Requests; workspace temporaneo eliminato                                 |
| Audit dipendenze pnpm                                  | Nessuna vulnerabilità nota riportata al momento della verifica                                                                                                 |
| Segreti                                                | Gitleaks 8.30.1 con output redatto: nessun segreto rilevato nei file pubblici e nella nuova cronologia                                                         |
| Dati privati                                           | Scansione di tutti i file pubblici, inclusi nascosti, esempi, fixture e documentazione; nessuna corrispondenza con i segreti personali dell'ambiente originale |
| Originale                                              | Hash dei file sorgente/documentazione controllati invariati; nessuna modifica apportata all'originale                                                          |
| Licenze                                                | Apache-2.0 per contributi originali; inventario delle licenze di 165 pacchetti risolti, incluse componenti opzionali, senza rilicenziare dipendenze            |

Le correzioni per la pubblicazione riguardano configurazione DB, isolamento delle fixture nei test, dipendenze con vulnerabilità note, formattazione e documentazione. I token sintetici delle fixture sono chiaramente distinti dalle credenziali reali. La CLI del seed non stampa più l'URL del database con la password.

La copia esclude `.env` personale, cronologia originale, metadati degli assistenti, cache, dipendenze installate, build, log e documenti interni di pianificazione. Il primo commit ha una nuova radice e usa l'indirizzo GitHub `noreply` dell'autore. L'analisi non è una certificazione di sicurezza né una verifica della provenienza di ogni riga di codice upstream.

## Limiti delle prove

- Nessuna chiave OpenAI, Anthropic o Artificial Analysis reale è stata utilizzata. Adapter e flussi runtime sono verificati con risposte simulate o provider HTTP locale.
- Nessun costo LLM sostenuto dai test. Le prove non misurano qualità, velocità effettiva dei servizi o risparmi.
- Il primo tentativo con Edge non ha raggiunto l'endpoint di automazione e ha incontrato un errore di accesso al profilo temporaneo. Lo stesso smoke è passato con Chrome e una cartella temporanea isolata. La compatibilità con ogni installazione di browser non è verificata.
- Gli smoke browser separati di Overview, Projects e Trial summary non sono stati eseguiti individualmente. Le rispettive parti di logica hanno copertura nelle suite indicate; il journey completo eseguito è quello self-serve.
- Nessun test di carico, servizio pubblico in hosting, recupero da disastro, uso multiutente o verifica live di tutti i modelli e prezzi.
- Le dipendenze e i risultati dell'audit possono cambiare: il controllo va ripetuto prima di un'eventuale distribuzione.

## Verifica su GitHub

Il workflow [CI](https://github.com/Flavio2702/neurallayer-ai/actions/workflows/ci.yml) ripete installazione, build, migrazioni, seed, lint, formattazione, typecheck e test su Linux con PostgreSQL, senza credenziali LLM. Il badge del README mostra lo stato effettivo della CI; non va interpretato come una verifica live dei provider. Gli smoke del browser restano controlli locali espliciti.
