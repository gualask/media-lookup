# media-lookup

Documento di progetto per `media-lookup`, un servizio HTTP leggero per recuperare e cachare metadati media, pensato per essere usato da app desktop o altri client senza distribuire token TMDB.

## Obiettivo

`media-lookup` espone un piccolo servizio API per:

- cercare metadati di film e serie TV;
- servire poster tramite proxy/cache;
- preparare uno snapshot giornaliero di titoli probabilmente utili;
- offrire una pagina minimale di controllo con poster e titoli;
- tracciare cache hit/miss e chiamate reali a TMDB.

Il servizio non deve essere legato a `irc-news`, anche se `irc-news` sara' il primo client.

## Principi

- Il token TMDB non deve mai stare nell'app desktop.
- Il client chiama solo `media-lookup`.
- Il Worker non deve essere scritto in modo troppo Cloudflare-specific nel core.
- Cloudflare e' il primo target di deploy, ma il codice deve poter migrare a Vercel, Supabase o altro con refactor limitato.
- Il contratto HTTP deve restare semplice e stabile.
- Cache e observability devono essere presenti senza trasformare il servizio in una piattaforma complessa.

## Nome

Repo: `media-lookup`.

Motivazione:

- breve;
- neutro su film/serie;
- non legato a TMDB;
- non legato a Cloudflare;
- non legato a `irc-news`;
- compatibile con futuri provider o fallback.

## Target Di Deploy Iniziale

Target iniziale: Cloudflare Workers.

Cloudflare non fornisce un server/IP da gestire. Il servizio viene eseguito sulla rete edge e raggiunto tramite HTTPS.

Endpoint iniziale:

```text
https://media-lookup.<account-subdomain>.workers.dev
```

In futuro si puo' usare un custom domain:

```text
https://media-lookup.example.com
```

L'app client usa una variabile tecnica:

```text
IRC_NEWS_METADATA_WORKER_URL=https://media-lookup.<account-subdomain>.workers.dev
```

## Portabilita'

Il core deve usare il modello Web standard:

```ts
Request -> handleRequest -> Response
```

Cloudflare, Vercel e Supabase Edge Functions supportano tutte `Request`, `Response` e `fetch`, ma differiscono su:

- env/secrets;
- cache;
- analytics;
- deploy config.

Quindi il core non deve usare direttamente:

- `env.TMDB_TOKEN`;
- `caches.default`;
- KV;
- Analytics Engine;
- API Cloudflare-specific.

Queste parti vivono negli adapter.

## Struttura Consigliata

```text
src/
  core/
    handleRequest.ts
    routes.ts
    tmdbClient.ts
    posterProxy.ts
    dailySnapshot.ts
    htmlPage.ts
    responses.ts
    types.ts
  ports/
    cache.ts
    env.ts
    metrics.ts
    storage.ts
  platforms/
    cloudflare.ts
  index.ts
test/
docs/
  project.md
package.json
wrangler.jsonc
README.md
.gitignore
LICENSE
```

## Dipendenze Core

Il core riceve dipendenze esplicite:

```ts
export interface Deps {
  env: {
    TMDB_TOKEN: string;
    DEFAULT_LANGUAGE: string;
  };
  fetch: typeof fetch;
  cache: CachePort;
  storage: StoragePort;
  metrics: MetricsPort;
}
```

Questo permette di cambiare piattaforma scrivendo un nuovo adapter, senza riscrivere logica TMDB o contratto HTTP.

## Contratto HTTP

Per compatibilita' con `irc-news`, si puo' partire con un endpoint base unico che legge query params.

### Lookup Metadati

```text
GET /?type=movie&title=Dune&year=2024&language=it-IT
GET /?type=tv&title=Breaking%20Bad&year=2008&language=it-IT
```

Risposta `200 application/json`:

```json
{
  "provider": "tmdb",
  "remoteId": "693134",
  "title": "Dune - Parte due",
  "year": 2024,
  "overview": "Trama localizzata se disponibile",
  "posterPath": "/abc123.jpg"
}
```

Se non trovato:

```text
404
```

oppure:

```text
204
```

Da scegliere e mantenere stabile. `irc-news` oggi gestisce entrambi come not found.

### Poster Proxy

```text
GET /?posterPath=/abc123.jpg&size=w342
```

Risposta:

```text
200 image/*
```

Regole:

- non esporre URL CDN TMDB al client;
- accettare solo `posterPath` normalizzato;
- usare dimensioni consentite;
- rispondere con `Content-Type` immagine;
- se il poster non esiste, `404` o `204`.

`irc-news` salva il poster in cache locale solo se la risposta ha `Content-Type: image/*` e bytes non vuoti.

### Daily Snapshot JSON

```text
GET /daily?language=it-IT
```

Risposta:

```json
{
  "generatedAt": "2026-06-02T00:00:00.000Z",
  "language": "it-IT",
  "items": [
    {
      "type": "movie",
      "provider": "tmdb",
      "remoteId": "123",
      "title": "Titolo",
      "year": 2026,
      "overview": "Trama breve",
      "posterPath": "/poster.jpg"
    }
  ]
}
```

### Pagina Mininale

```text
GET /
```

Risposta HTML minimale con:

- griglia poster;
- titolo;
- anno;
- tipo `movie` / `tv`;
- attribution TMDB.

I poster nella pagina devono passare dal proxy locale:

```html
<img src="/?posterPath=/abc123.jpg&size=w342">
```

Non serve una vera frontend app iniziale.

## TMDB

Provider iniziale: TMDB.

Il token sta solo su Cloudflare come secret:

```text
TMDB_TOKEN
```

In locale:

```text
.dev.vars
```

Da non committare.

Il Worker deve includere attribution:

```text
This product uses the TMDB API but is not endorsed or certified by TMDB.
```

Non usare `TMDB` nel nome repo o come identita' principale del servizio.

## Cache

### Cache Lookup

Il lookup metadata deve essere cachato.

Possibile chiave:

```text
lookup:v1:<language>:<type>:<normalized-title>:<year-or-none>
```

Risposta cachata:

- JSON normalizzato;
- status `found` / `not_found`;
- provider;
- remote id;
- poster path.

### Cache Poster

Il poster proxy deve cachare le immagini remote.

Possibile chiave:

```text
poster:v1:<size>:<posterPath>
```

Su Cloudflare:

- Cache API per poster e lookup transient;
- response headers appropriati.

### Daily Snapshot

Per lo snapshot giornaliero usare KV, non Cache API.

Chiave:

```text
daily:v1:it-IT
```

KV e' adatto a uno snapshot JSON aggiornato una volta al giorno e letto spesso.

D1 non serve all'inizio. Valutarlo solo se servono:

- storico;
- ricerca interna;
- filtri complessi;
- analytics persistenti;
- dati relazionali.

## Cron Giornaliero

Cloudflare Workers supporta Cron Triggers con handler `scheduled()`.

Flusso:

```text
scheduled()
  -> recupera titoli TMDB probabilmente utili
  -> normalizza movie/tv
  -> salva daily snapshot in KV
  -> registra metriche
```

Frequenza iniziale:

```text
1 volta al giorno
```

I cron Cloudflare girano in UTC.

Limiti iniziali:

- 20-50 film;
- 20-50 serie;
- lingua `it-IT`;
- nessuno storico;
- nessuna UI ricca.

## Observability

Servono tre livelli.

### Built-in Cloudflare

Usare dashboard Cloudflare per:

- request count;
- errori;
- CPU/wall time;
- subrequests;
- traffico generale.

### Logs Di Debug

Usare logs strutturati durante sviluppo:

```ts
console.log(JSON.stringify({
  event: "lookup",
  cache: "hit",
  provider: "tmdb",
  type: "movie",
  language: "it-IT"
}));
```

Non usare i log come metrica principale.

### Metriche Custom

Usare una porta:

```ts
export interface MetricsPort {
  record(event: MetricsEvent): void;
}
```

Su Cloudflare adapter: Workers Analytics Engine.

Metriche minime:

```text
route: lookup | poster | daily | page
cache: hit | miss | bypass
provider: tmdb
tmdbCalls: number
status: ok | error | not_found
mediaType: movie | tv | none
language: it-IT
```

Evitare KV per contatori incrementali.

## Config Cloudflare

Secret:

```text
TMDB_TOKEN
```

Binding consigliati:

```text
DAILY_KV
ANALYTICS
```

Config non sensibili:

```text
DEFAULT_LANGUAGE=it-IT
ALLOWED_POSTER_SIZES=w342,w500
```

## Contratto Con irc-news

`irc-news` si aspetta:

Lookup:

```text
GET <WORKER_URL>?type=movie|tv&title=<title>&language=<language>&year=<optional>
```

Poster:

```text
GET <WORKER_URL>?posterPath=<posterPath>&size=w342
```

Risposta metadata accettata:

```json
{
  "provider": "tmdb",
  "remoteId": "123",
  "overview": "testo",
  "posterPath": "/poster.jpg",
  "year": 2026
}
```

Alias ancora tollerati lato app, ma il Worker nuovo deve preferire:

- `posterPath`;
- `remoteId`;
- `year`.

## Non Obiettivi Iniziali

- UI frontend completa;
- login utenti;
- scelta provider da UI;
- DB relazionale;
- storico giornaliero;
- multi-client policy complessa;
- rate limiting custom pesante;
- secret nell'app desktop;
- nomi o branding TMDB come identita' principale.

## Roadmap

### Fase 1

- Scaffold Worker TypeScript;
- adapter Cloudflare;
- lookup TMDB;
- poster proxy;
- cache base;
- test core.

### Fase 2

- KV daily snapshot;
- cron giornaliero;
- pagina HTML minimale;
- attribution TMDB.

### Fase 3

- Analytics Engine;
- dashboard/query metriche;
- tuning cache;
- eventuale fallback provider.

### Fase 4

- Adapter alternativo Vercel/Supabase se Cloudflare non e' piu' adatto.
