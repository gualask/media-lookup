import { HOME_STYLES } from './homeStyles';
import { TMDB_LOGO_SVG } from './tmdbLogo';
import type { DailySnapshot, DailySnapshotItem, DailySnapshotSource, MediaType } from './types';

const ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const POSTER_SIZE = 'w185';

// Shorter overviews always fit in the clamped lines (see homeStyles.ts). Longer ones get "Leggi tutto", which the
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
${HOME_STYLES}
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
