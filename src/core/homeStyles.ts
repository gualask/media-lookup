// The home page stylesheet, inlined in the page so it needs no extra request.

/** Overviews show this many lines; "Leggi tutto" opens the rest. */
const OVERVIEW_LINES = 8;

export const HOME_STYLES = `    :root {
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
    }`;
