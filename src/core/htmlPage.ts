import type { DailySnapshot, DailySnapshotItem, DailySnapshotSource, MediaType } from './types';

const ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const POSTER_SIZE = 'w185';

const SECTIONS: readonly {
  type: MediaType;
  source: DailySnapshotSource;
  label: string;
}[] = [
  {
    type: 'movie',
    source: 'movie_home_release_recent',
    label: 'Film recenti streaming e home video',
  },
  { type: 'movie', source: 'movie_trending_recent', label: 'Film in tendenza recenti' },
  { type: 'movie', source: 'movie_theatrical_recent', label: 'Film recenti al cinema' },
  { type: 'movie', source: 'movie_theatrical_upcoming', label: 'Film in arrivo al cinema' },
  { type: 'tv', source: 'tv_recent_episodes', label: 'Serie con episodi recenti' },
  { type: 'tv', source: 'tv_upcoming_episodes', label: 'Serie con episodi in arrivo' },
];

export function renderPreviewPage(snapshot: DailySnapshot | null): string {
  const items = snapshot?.items ?? [];
  const sections =
    items.length > 0 ? renderSections(items, snapshot?.language ?? 'it-IT') : renderEmptyState();

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>media-lookup</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111318;
      color: #f4f5f7;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: #111318;
    }

    main {
      width: calc(100% - 60px);
      margin: 0 auto;
      padding: 30px 0;
    }

    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      gap: 16px;
      align-items: baseline;
      margin-bottom: 28px;
      border-bottom: 1px solid #2d333f;
      padding-bottom: 16px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
    }

    h2 {
      margin: 0 0 18px;
      font-size: 20px;
      font-weight: 700;
      line-height: 1.2;
    }

    h3 {
      margin: 0 0 4px;
      font-size: 15px;
      line-height: 1.25;
      max-height: 56px;
      overflow: auto;
      scrollbar-color: #475263 #151922;
      scrollbar-width: thin;
    }

    section {
      margin: 0 0 44px;
    }

    section + section {
      border-top: 1px solid #2d333f;
      padding-top: 22px;
    }

    .meta {
      margin: 0;
      color: #aeb7c4;
      font-size: 14px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 16px;
      align-items: start;
    }

    article {
      display: grid;
      grid-template-columns: 185px minmax(0, 1fr);
      gap: 12px;
      height: 278px;
      min-width: 0;
      overflow: hidden;
    }

    img,
    .poster-placeholder {
      width: 185px;
      height: 278px;
      aspect-ratio: 2 / 3;
      object-fit: cover;
      background: #202631;
      border-radius: 6px;
      display: block;
    }

    .poster-placeholder {
      border: 1px solid #303844;
    }

    .card-body {
      display: flex;
      min-width: 0;
      height: 278px;
      flex-direction: column;
      overflow: hidden;
    }

    .details,
    footer {
      color: #aeb7c4;
      font-size: 12px;
    }

    .details {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: baseline;
    }

    .details a {
      color: #8fb7ff;
      text-decoration: none;
    }

    .details a:hover {
      text-decoration: underline;
    }

    .overview {
      margin: 8px 0 0;
      flex: 1;
      min-height: 0;
      overflow: auto;
      color: #d9dde4;
      font-size: 13px;
      line-height: 1.45;
      white-space: normal;
      scrollbar-color: #475263 #151922;
      scrollbar-width: thin;
    }

    .overview-empty {
      color: #aeb7c4;
    }

    .overview-action {
      border: 1px solid #394454;
      border-radius: 5px;
      padding: 5px 8px;
      background: #1b2230;
      color: #f4f5f7;
      cursor: pointer;
      font: inherit;
    }

    .overview-action:disabled {
      cursor: default;
      opacity: 0.65;
    }

    .overview-status {
      display: block;
      margin-top: 8px;
    }

    footer {
      margin-top: 28px;
    }

    @media (max-width: 520px) {
      .grid {
        grid-template-columns: minmax(0, 1fr);
      }

      article {
        grid-template-columns: 128px minmax(0, 1fr);
        height: 192px;
      }

      img,
      .poster-placeholder {
        width: 128px;
        height: 192px;
      }

      .card-body {
        height: 192px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Media lookup</h1>
      <p class="meta">${escapeHtml(snapshot ? `${items.length} item` : 'No daily snapshot yet')}</p>
      <p class="meta">${escapeHtml(snapshot?.generatedAt ?? '')}</p>
    </header>
    ${sections}
    <footer>${ATTRIBUTION}</footer>
  </main>
  <script>
    (() => {
      const STORAGE_PREFIX = 'mediaLookup.overviewFallback.v1';

      const storageKey = (button) =>
        [STORAGE_PREFIX, button.dataset.language, button.dataset.type, button.dataset.id].join(':');

      const applyOverview = (target, overview) => {
        target.classList.remove('overview-empty');
        target.textContent = overview || 'Trama non disponibile nemmeno in inglese.';
      };

      const hydrateCachedOverviews = () => {
        for (const button of document.querySelectorAll('[data-overview-button]')) {
          try {
            const cached = localStorage.getItem(storageKey(button));

            if (!cached) {
              continue;
            }

            const data = JSON.parse(cached);
            const target = button.closest('[data-overview-target]');

            if (target && typeof data.overview === 'string') {
              applyOverview(target, data.overview);
            }
          } catch {
            localStorage.removeItem(storageKey(button));
          }
        }
      };

      document.addEventListener('click', async (event) => {
        const eventTarget = event.target;

        if (!(eventTarget instanceof Element)) {
          return;
        }

        const button = eventTarget.closest('[data-overview-button]');

        if (!button) {
          return;
        }

        const target = button.closest('[data-overview-target]');
        const status = target?.querySelector('[data-overview-status]');

        if (!target || !status) {
          return;
        }

        const params = new URLSearchParams({
          type: button.dataset.type,
          id: button.dataset.id,
          language: button.dataset.language,
        });

        button.disabled = true;
        button.textContent = 'Recupero...';
        status.textContent = '';

        try {
          const response = await fetch('/translate?' + params.toString(), {
            headers: { Accept: 'application/json' },
          });

          if (response.status === 404) {
            button.textContent = 'Non disponibile';
            status.textContent = 'Trama non disponibile nemmeno in inglese.';
            return;
          }

          if (!response.ok) {
            throw new Error('Request failed');
          }

          const data = await response.json();
          applyOverview(target, data.overview);

          try {
            localStorage.setItem(storageKey(button), JSON.stringify(data));
          } catch {
            // Ignore storage failures; KV still keeps the fallback for future renders.
          }
        } catch {
          button.disabled = false;
          button.textContent = 'Riprova';
          status.textContent = 'Errore nel recupero.';
        }
      });

      hydrateCachedOverviews();
    })();
  </script>
</body>
</html>`;
}

function renderSections(items: readonly DailySnapshotItem[], language: string): string {
  return SECTIONS.map((section) => {
    const sectionItems = items.filter(
      (item) => item.type === section.type && item.source === section.source,
    );

    if (sectionItems.length === 0) {
      return '';
    }

    return `<section>
  <h2>${section.label}</h2>
  <div class="grid">${sectionItems.map((item) => renderItem(item, language)).join('')}</div>
</section>`;
  }).join('');
}

function renderItem(item: DailySnapshotItem, language: string): string {
  const poster = item.posterPath
    ? `<img src="${escapeHtml(tmdbPosterUrl(item.posterPath))}" alt="">`
    : '<div class="poster-placeholder" aria-hidden="true"></div>';
  const year = item.year ? ` · ${item.year}` : '';
  const overview = item.overview.trim()
    ? `<p class="overview">${escapeHtml(item.overview.trim())}</p>`
    : renderMissingOverview(item, language);

  return `<article>
  ${poster}
  <div class="card-body">
    <h3>${escapeHtml(item.title)}</h3>
    <div class="details">
      <span>${item.type}${year}</span>
      <a href="${escapeHtml(youtubeTrailerSearchUrl(item))}" target="_blank" rel="noopener noreferrer">Trailer</a>
    </div>
    ${overview}
  </div>
</article>`;
}

function tmdbPosterUrl(posterPath: string): string {
  const normalizedPath = posterPath.startsWith('/') ? posterPath.slice(1) : posterPath;
  return `${TMDB_IMAGE_BASE_URL}/${POSTER_SIZE}/${encodeURIComponent(normalizedPath)}`;
}

function youtubeTrailerSearchUrl(item: DailySnapshotItem): string {
  const query = [item.title, item.year?.toString(), 'trailer italiano'].filter(Boolean).join(' ');
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function renderMissingOverview(item: DailySnapshotItem, language: string): string {
  return `<div class="overview overview-empty" data-overview-target>
      <button class="overview-action" type="button" data-overview-button data-type="${escapeHtml(item.type)}" data-id="${escapeHtml(item.remoteId)}" data-language="en-US">Recupera trama EN</button>
      <span class="overview-status" data-overview-status>${escapeHtml(missingOverviewStatus(language))}</span>
    </div>`;
}

function missingOverviewStatus(language: string): string {
  if (language === 'it-IT') {
    return 'Trama italiana non disponibile.';
  }

  if (language === 'en-US') {
    return 'Trama inglese non disponibile.';
  }

  return `Trama non disponibile in ${language}.`;
}

function renderEmptyState(): string {
  return `<section>
  <h2>No daily snapshot</h2>
  <div class="grid">
    <article>
      <div class="poster-placeholder" aria-hidden="true"></div>
      <div class="card-body">
        <h3>No daily snapshot</h3>
        <div class="details">Visit the home page to generate the daily snapshot.</div>
      </div>
    </article>
  </div>
</section>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
