import { describe, expect, it } from 'vitest';
import { renderPreviewPage } from '../../src/core/htmlPage';
import type { DailySnapshot, DailySnapshotItem } from '../../src/core/types';

function item(overrides: Partial<DailySnapshotItem>): DailySnapshotItem {
  return {
    type: 'movie',
    provider: 'tmdb',
    remoteId: '1',
    title: 'Dune - Parte due',
    year: 2024,
    overview: 'Trama breve.',
    posterPath: '/dune.jpg',
    source: 'movie_theatrical_recent',
    ...overrides,
  };
}

function snapshot(items: DailySnapshotItem[]): DailySnapshot {
  return { generatedAt: '2026-10-10T08:29:06.680Z', language: 'it-IT', items };
}

describe('renderPreviewPage', () => {
  it('splits films and series into tabs with counts and section links', () => {
    const html = renderPreviewPage(
      snapshot([
        item({ remoteId: '1' }),
        item({ remoteId: '2', source: 'movie_trending_recent' }),
        item({ remoteId: '3', type: 'tv', title: 'Lanterns', source: 'tv_premiere_recent' }),
      ]),
      'Europe/Rome',
    );

    expect(html).toContain(
      '<input class="tab-input" type="radio" name="category" id="tab-movie" checked>',
    );
    expect(html).toContain(
      '<label class="tab" for="tab-movie">Film <span class="count">2</span></label>',
    );
    expect(html).toContain(
      '<label class="tab" for="tab-tv">Serie <span class="count">1</span></label>',
    );
    expect(html).toContain('<a href="#movie_trending_recent">In tendenza</a>');
    expect(html).toContain('<a href="#tv_premiere_recent">Serie nuove</a>');
    expect(html).not.toContain('href="#tv_recent_episodes"');
    expect(html).toContain('<section id="tv_premiere_recent">');
    expect(html).toContain('il 10 ottobre alle 10:29');
  });

  it('clamps overviews without an inner scroll area and offers more only for long ones', () => {
    const html = renderPreviewPage(
      snapshot([
        item({ remoteId: '1', overview: 'Breve.' }),
        item({ remoteId: '2', overview: 'Lunga. '.repeat(60) }),
      ]),
      'Europe/Rome',
    );

    expect(html).not.toContain('overflow: auto');
    expect(html.match(/<details class="more">/g)).toHaveLength(1);
    expect(html).toContain('Leggi tutto');
  });

  it('lazy-loads posters with fixed dimensions', () => {
    const html = renderPreviewPage(snapshot([item({})]), 'Europe/Rome');

    expect(html).toContain(
      '<img class="poster" src="https://image.tmdb.org/t/p/w185/dune.jpg" alt="" width="185" height="278" loading="lazy" decoding="async">',
    );
  });

  it('explains an empty category instead of leaving the panel blank', () => {
    const html = renderPreviewPage(snapshot([item({})]), 'Europe/Rome');

    expect(html).toContain('<p class="empty">Nessun titolo da mostrare per serie.</p>');
  });
});
