import { TMDB_LOGO_SVG } from './tmdbLogo';
import type { DailySnapshot, DailySnapshotItem, DailySnapshotSource, MediaType } from './types';

const ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const POSTER_SIZE = 'w185';

const OVERVIEW_LINES = 8;
// Shorter overviews always fit in OVERVIEW_LINES lines. Longer ones get "Leggi tutto", which the
// page script hides again when the text turns out to fit.
const OVERVIEW_TOGGLE_MIN_CHARS = 160;

const CATEGORIES: readonly {
  type: MediaType;
  label: string;
  sections: readonly { source: DailySnapshotSource; label: string }[];
}[] = [
  {
    type: 'movie',
    label: 'Film',
    sections: [
      { source: 'movie_home_release_recent', label: 'Streaming e home video' },
      { source: 'movie_trending_recent', label: 'In tendenza' },
      { source: 'movie_theatrical_recent', label: 'Al cinema' },
      { source: 'movie_theatrical_upcoming', label: 'In arrivo al cinema' },
    ],
  },
  {
    type: 'tv',
    label: 'Serie',
    sections: [
      { source: 'tv_premiere_recent', label: 'Serie nuove' },
      { source: 'tv_recent_episodes', label: 'Nuovi episodi' },
      { source: 'tv_premiere_upcoming', label: 'In arrivo' },
    ],
  },
];

export function renderPreviewPage(snapshot: DailySnapshot | null, timeZone: string): string {
  const items = snapshot?.items ?? [];
  const language = snapshot?.language ?? 'it-IT';

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>Media lookup</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111318;
      --surface: #1a1e26;
      --surface-strong: #252b36;
      --line: #2d333f;
      --text: #f4f5f7;
      --text-soft: #d9dde4;
      --muted: #aeb7c4;
      --accent: #8fb7ff;
      --poster-width: 185px;
      --poster-height: 278px;
      --topbar-offset: 132px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
    }

    /* The category tabs are radio buttons, so switching needs no script. */
    .tab-input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 1;
      background: color-mix(in srgb, var(--bg) 92%, transparent);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--line);
    }

    .topbar-inner,
    .jump,
    main {
      width: min(100% - 60px, 1600px);
      margin: 0 auto;
    }

    .topbar-inner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px 24px;
      padding: 16px 0 12px;
    }

    .brand {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 14px;
    }

    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
    }

    .meta {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }

    .tabs {
      display: flex;
      gap: 4px;
      padding: 3px;
      border-radius: 9px;
      background: var(--surface);
    }

    .tab {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 7px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }

    .tab:hover {
      color: var(--text);
    }

    .count {
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
    }

    body:has(#tab-movie:checked) .tab[for="tab-movie"],
    body:has(#tab-tv:checked) .tab[for="tab-tv"] {
      background: var(--surface-strong);
      color: var(--text);
    }

    body:has(#tab-movie:focus-visible) .tab[for="tab-movie"],
    body:has(#tab-tv:focus-visible) .tab[for="tab-tv"] {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }

    .jump {
      display: flex;
      gap: 8px;
      padding: 0 0 12px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .jump a {
      flex: none;
      padding: 4px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--text-soft);
      font-size: 12.5px;
      text-decoration: none;
    }

    .jump a:hover {
      border-color: var(--muted);
      color: var(--text);
    }

    body:has(#tab-movie:checked) :is(.jump-tv, .panel-tv),
    body:has(#tab-tv:checked) :is(.jump-movie, .panel-movie) {
      display: none;
    }

    main {
      padding: 28px 0 32px;
    }

    section {
      margin: 0 0 40px;
      scroll-margin-top: var(--topbar-offset);
    }

    h2 {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 0 0 16px;
      font-size: 19px;
      line-height: 1.2;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 20px 18px;
      align-items: start;
    }

    .card {
      display: grid;
      grid-template-columns: var(--poster-width) minmax(0, 1fr);
      gap: 14px;
      min-width: 0;
    }

    .poster {
      width: var(--poster-width);
      height: var(--poster-height);
      object-fit: cover;
      border-radius: 6px;
      background: var(--surface-strong);
      display: block;
    }

    .poster-missing {
      display: grid;
      place-items: center;
      box-sizing: border-box;
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }

    .card-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      min-height: var(--poster-height);
    }

    .title {
      margin: 0;
      font-size: 15px;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      overflow: hidden;
    }

    .details {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: baseline;
      margin: 0;
      color: var(--muted);
      font-size: 12.5px;
    }

    .details a {
      color: var(--accent);
      text-decoration: none;
    }

    .details a:hover {
      text-decoration: underline;
    }

    /* Clamped, never scrollable: an inner scroll area would catch the wheel while the page scrolls. */
    .overview {
      margin: 2px 0 0;
      color: var(--text-soft);
      font-size: 13px;
      line-height: 1.45;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: ${OVERVIEW_LINES};
      line-clamp: ${OVERVIEW_LINES};
      overflow: hidden;
    }

    .overview-empty {
      color: var(--muted);
    }

    .card:has(.more[open]) .overview {
      display: block;
      -webkit-line-clamp: unset;
      line-clamp: none;
    }

    .more summary {
      display: inline;
      color: var(--accent);
      font-size: 12.5px;
      cursor: pointer;
      list-style: none;
    }

    .more summary::-webkit-details-marker {
      display: none;
    }

    .more[open] .when-closed,
    .more:not([open]) .when-open {
      display: none;
    }

    .empty {
      color: var(--muted);
      font-size: 14px;
    }

    footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }

    /* Smaller than the page title, as TMDB asks for its logo. */
    .tmdb-logo {
      display: block;
      flex: none;
    }

    .tmdb-logo svg {
      display: block;
      height: 12px;
      width: auto;
    }

    @media (max-width: 560px) {
      :root {
        --poster-width: 120px;
        --poster-height: 180px;
        --topbar-offset: 170px;
      }

      .topbar-inner,
      .jump,
      main {
        width: calc(100% - 32px);
      }

      .grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  </style>
</head>
<body>
  ${CATEGORIES.map(
    (category, index) =>
      `<input class="tab-input" type="radio" name="category" id="tab-${category.type}"${index === 0 ? ' checked' : ''}>`,
  ).join('\n  ')}
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <h1>Media lookup</h1>
        ${snapshot ? `<p class="meta">Aggiornato ${renderGeneratedAt(snapshot.generatedAt, timeZone)}</p>` : ''}
      </div>
      <nav class="tabs" aria-label="Categoria">
        ${CATEGORIES.map(
          (category) =>
            `<label class="tab" for="tab-${category.type}">${category.label} <span class="count">${countItems(items, category.type)}</span></label>`,
        ).join('\n        ')}
      </nav>
    </div>
    ${CATEGORIES.map((category) => renderJumpLinks(category, items)).join('\n    ')}
  </header>
  <main>
    ${CATEGORIES.map((category) => renderPanel(category, items, language, snapshot !== null)).join('\n    ')}
    <footer>
      <a class="tmdb-logo" href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" aria-label="The Movie Database (TMDB)">${TMDB_LOGO_SVG}</a>
      <span>${ATTRIBUTION}</span>
    </footer>
  </main>
  <script>
    // Hides "Leggi tutto" where the clamped overview already shows all of its text.
    const syncOverviewToggles = () => {
      for (const more of document.querySelectorAll('.more:not([open])')) {
        const overview = more.previousElementSibling;
        if (overview && overview.offsetParent !== null) {
          more.hidden = overview.scrollHeight <= overview.clientHeight + 1;
        }
      }
    };
    syncOverviewToggles();
    addEventListener('resize', syncOverviewToggles);
    for (const tab of document.querySelectorAll('.tab-input')) {
      tab.addEventListener('change', syncOverviewToggles);
    }
  </script>
</body>
</html>`;
}

type Category = (typeof CATEGORIES)[number];

function countItems(items: readonly DailySnapshotItem[], type: MediaType): number {
  return items.filter((item) => item.type === type).length;
}

function sectionItems(
  items: readonly DailySnapshotItem[],
  type: MediaType,
  source: DailySnapshotSource,
): DailySnapshotItem[] {
  return items.filter((item) => item.type === type && item.source === source);
}

function renderJumpLinks(category: Category, items: readonly DailySnapshotItem[]): string {
  const links = category.sections
    .filter((section) => sectionItems(items, category.type, section.source).length > 0)
    .map((section) => `<a href="#${section.source}">${section.label}</a>`)
    .join('');

  return links
    ? `<nav class="jump jump-${category.type}" aria-label="Sezioni ${category.label.toLowerCase()}">${links}</nav>`
    : '';
}

function renderPanel(
  category: Category,
  items: readonly DailySnapshotItem[],
  language: string,
  hasSnapshot: boolean,
): string {
  const sections = category.sections
    .map((section) => {
      const cards = sectionItems(items, category.type, section.source);

      if (cards.length === 0) {
        return '';
      }

      return `<section id="${section.source}">
      <h2>${section.label} <span class="count">${cards.length}</span></h2>
      <div class="grid">${cards.map((item) => renderItem(item, language)).join('')}</div>
    </section>`;
    })
    .join('');
  const empty = hasSnapshot
    ? `Nessun titolo da mostrare per ${category.label.toLowerCase()}.`
    : 'Nessuno snapshot disponibile: riprova più tardi.';

  return `<div class="panel panel-${category.type}">${sections || `<p class="empty">${empty}</p>`}</div>`;
}

function renderGeneratedAt(generatedAt: string, timeZone: string): string {
  const date = new Date(generatedAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const day = new Intl.DateTimeFormat('it-IT', { timeZone, day: 'numeric', month: 'long' }).format(
    date,
  );
  const time = new Intl.DateTimeFormat('it-IT', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  return `<time datetime="${escapeHtml(generatedAt)}">il ${day} alle ${time}</time>`;
}

function renderItem(item: DailySnapshotItem, language: string): string {
  const poster = item.posterPath
    ? `<img class="poster" src="${escapeHtml(tmdbPosterUrl(item.posterPath))}" alt="" width="185" height="278" loading="lazy" decoding="async">`
    : '<div class="poster poster-missing" aria-hidden="true">Nessuna locandina</div>';
  const overviewText = item.overview.trim();
  const overview = overviewText
    ? `<p class="overview">${escapeHtml(overviewText)}</p>${
        overviewText.length > OVERVIEW_TOGGLE_MIN_CHARS
          ? '<details class="more"><summary><span class="when-closed">Leggi tutto</span><span class="when-open">Riduci</span></summary></details>'
          : ''
      }`
    : renderMissingOverview(language);

  return `<article class="card">
  ${poster}
  <div class="card-body">
    <h3 class="title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
    <p class="details">
      ${item.year ? `<span>${item.year}</span>` : ''}
      <a href="${escapeHtml(youtubeTrailerSearchUrl(item))}" target="_blank" rel="noopener noreferrer">Trailer</a>
    </p>
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

function renderMissingOverview(language: string): string {
  return `<p class="overview overview-empty">${escapeHtml(missingOverviewStatus(language))}</p>`;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
