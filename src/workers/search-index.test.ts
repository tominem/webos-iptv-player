import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { SearchWorkerIndex } from './search-index';

interface PostedSources {
  channels?: string[][];
  programmes?: string[][];
  movies?: string[];
  series?: string[];
}

// Posts each source as one chunk, the way the page posts a small source.
function post(index: SearchWorkerIndex, sessionId: number, sources: PostedSources, reset = true): boolean {
  let accepted = true;
  const take = (response: unknown): void => {
    if (!(response as { accepted?: boolean }).accepted) accepted = false;
  };
  if (reset) take(index.index({ sessionId, reset: true }));
  for (const source of ['channels', 'programmes', 'movies', 'series'] as const) {
    const documents = sources[source];
    if (!documents) continue;
    const named = source === 'movies' || source === 'series';
    take(index.index({
      sessionId,
      chunk: named
        ? { source, start: 0, total: documents.length, names: documents as string[] }
        : { source, start: 0, total: documents.length, documents: documents as string[][] },
    }));
  }
  return accepted;
}

describe('SearchWorkerIndex', () => {
  it('indexes and ranks every search collection', () => {
    const index = new SearchWorkerIndex();
    expect(post(index, 1, {
      channels: [['XAlpha', 'News'], ['Alpha', 'Drama']],
      programmes: [['Evening Report', 'News'], ['Alpha Report', 'Drama']],
      movies: ['XAlpha Movie', 'Alpha Movie'],
      series: ['XAlpha Series', 'Alpha Series'],
    })).toBe(true);

    expect(index.query({
      sessionId: 1,
      query: 'alpha',
      limit: 10,
      includeCatalog: true,
    })).toEqual({
      channels: { indices: [1, 0], hasMore: false },
      programmes: { indices: [1], hasMore: false },
      movies: { indices: [1, 0], hasMore: false },
      series: { indices: [1, 0], hasMore: false },
    });
  });

  it('rejects stale index updates and queries', () => {
    const index = new SearchWorkerIndex();
    post(index, 2, { channels: [['Alpha']] });

    expect(post(index, 1, { channels: [['Bravo']] }, false)).toBe(false);
    expect(index.query({
      sessionId: 1,
      query: 'alpha',
      limit: 10,
      includeCatalog: false,
    })).toBeNull();
    expect(index.query({
      sessionId: 2,
      query: 'alpha',
      limit: 10,
      includeCatalog: false,
    })?.channels.indices).toEqual([0]);
  });

  it('caps results and reports additional matches', () => {
    const index = new SearchWorkerIndex();
    post(index, 1, { movies: ['Alpha 1', 'Alpha 2', 'Alpha 3'] });

    expect(index.query({
      sessionId: 1,
      query: 'alpha',
      limit: 2,
      includeCatalog: true,
    })?.movies).toEqual({ indices: [0, 1], hasMore: true });
  });

  it('assembles a source from ordered chunks and serves it only once complete', () => {
    const index = new SearchWorkerIndex();
    post(index, 1, { channels: [['Old Alpha']] });
    const ask = () => index.query({ sessionId: 1, query: 'alpha', limit: 10, includeCatalog: false });

    expect(index.index({
      sessionId: 1,
      chunk: { source: 'channels', start: 0, total: 3, documents: [['Alpha 1'], ['Bravo']] },
    })).toEqual({ accepted: true });
    // The old channel list is gone while the new one is still arriving.
    expect(ask()?.channels.indices).toEqual([]);
    expect(index.index({
      sessionId: 1,
      chunk: { source: 'channels', start: 2, total: 3, documents: [['Alpha 3']] },
    })).toEqual({ accepted: true });
    expect(ask()?.channels.indices).toEqual([0, 2]);
  });

  it('keeps serving the previous catalog until a refresh post completes', () => {
    const index = new SearchWorkerIndex();
    post(index, 1, { movies: ['Alpha Movie'], series: ['Alpha Series'] });
    const ask = () => index.query({ sessionId: 1, query: 'alpha', limit: 10, includeCatalog: true });

    index.index({
      sessionId: 1,
      chunk: { source: 'movies', start: 0, total: 3, names: ['Bravo Movie', 'Alpha Movie'] },
    });
    expect(ask()?.movies.indices).toEqual([0]);
    expect(index.index({
      sessionId: 1,
      chunk: { source: 'movies', start: 5, total: 3, names: ['Alpha Two'] },
    })).toEqual({ accepted: false });
    // A rejected post leaves the previous list as well.
    expect(ask()?.movies.indices).toEqual([0]);
    expect(ask()?.series.indices).toEqual([0]);

    index.index({
      sessionId: 1,
      chunk: { source: 'movies', start: 0, total: 3, names: ['Bravo Movie', 'Alpha Movie'] },
    });
    index.index({ sessionId: 1, chunk: { source: 'movies', start: 2, total: 3, names: ['Alpha Two'] } });
    expect(ask()?.movies.indices.slice().sort()).toEqual([1, 2]);
  });

  it('rejects a chunk that skips or overruns the staged documents', () => {
    const index = new SearchWorkerIndex();
    index.index({ sessionId: 1, reset: true });
    index.index({ sessionId: 1, chunk: { source: 'movies', start: 0, total: 3, names: ['Alpha 1'] } });

    expect(index.index({
      sessionId: 1,
      chunk: { source: 'movies', start: 2, total: 3, names: ['Alpha 3'] },
    })).toEqual({ accepted: false });
    expect(index.index({
      sessionId: 1,
      chunk: { source: 'series', start: 0, total: 1, names: ['Alpha 1', 'Alpha 2'] },
    })).toEqual({ accepted: false });
  });

  it('drops staged chunks when a new session resets the index', () => {
    const index = new SearchWorkerIndex();
    index.index({ sessionId: 1, reset: true });
    index.index({ sessionId: 1, chunk: { source: 'series', start: 0, total: 2, names: ['Alpha 1'] } });
    index.index({ sessionId: 2, reset: true });

    expect(index.index({
      sessionId: 2,
      chunk: { source: 'series', start: 1, total: 2, names: ['Alpha 2'] },
    })).toEqual({ accepted: false });
  });

  describe('a large programme source', () => {
    const slice = CONFIG.SEARCH.FOLD_SLICE_SIZE;
    const programmes = Array.from({ length: slice * 2 + 5 }, (_, i) => [
      i % 2 ? 'Alpha Show' : 'Bravo Show', 'News', `Episode ${i}`, 'Channel One', 'Group',
    ]);

    function start(index: SearchWorkerIndex): Promise<unknown> {
      post(index, 1, { channels: [['Alpha Channel', 'News'], ['Bravo Channel', 'News']] });
      return index.index({
        sessionId: 1,
        chunk: { source: 'programmes', start: 0, total: programmes.length, documents: programmes },
      }) as Promise<unknown>;
    }

    it('answers queries from the other sources while it is still folding', async () => {
      const index = new SearchWorkerIndex();
      const folding = start(index);

      const early = index.query({ sessionId: 1, query: 'alpha', limit: 10, includeCatalog: false });
      expect(early).toMatchObject({
        channels: { indices: [0] },
        programmes: { indices: [] },
      });

      expect(await folding).toEqual({ accepted: true });
      const done = await index.query({ sessionId: 1, query: 'alpha', limit: 5, includeCatalog: false });
      expect((done as { programmes: { indices: number[] } }).programmes.indices).toHaveLength(5);
    });

    it('ranks like the unmemoized fold', async () => {
      const index = new SearchWorkerIndex();
      await start(index);
      const small = new SearchWorkerIndex();
      post(small, 1, { channels: [['Alpha Channel', 'News']], programmes: programmes.slice(0, slice) });

      const query = { sessionId: 1, query: 'episode 7', limit: 3, includeCatalog: false };
      const large = await index.query(query) as { programmes: { indices: number[] } };
      const reference = await small.query(query) as { programmes: { indices: number[] } };
      expect(large.programmes.indices.filter(i => i < slice).sort()).toEqual(
        reference.programmes.indices.filter(i => i < slice).sort(),
      );
    });
  });
});
