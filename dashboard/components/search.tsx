'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type AlgoliaHit = {
  objectID: string;
  url: string;
  hierarchy?: Record<string, string | null>;
  content?: string | null;
  _snippetResult?: { content?: { value: string } };
};

export default function Search() {
  const algoliaConfig = useMemo(
    () => ({
      appId: process.env.NEXT_PUBLIC_DOCSEARCH_APP_ID || 'INUYES5FGM',
      apiKey: process.env.NEXT_PUBLIC_DOCSEARCH_API_KEY || '2b3fe9b2882e46e19fa5fce6272efe4f',
      indexName: process.env.NEXT_PUBLIC_DOCSEARCH_INDEX_NAME || 'Docs',
    }),
    [],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AlgoliaHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [noResults, setNoResults] = useState(false);

  const clearSearch = useCallback(() => {
    setQuery('');
    setHits([]);
    setNoResults(false);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setNoResults(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const searchEndpoint = `https://${algoliaConfig.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(
          algoliaConfig.indexName,
        )}/query`;
        const response = await fetch(searchEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Algolia-API-Key': algoliaConfig.apiKey,
            'X-Algolia-Application-Id': algoliaConfig.appId,
          },
          body: JSON.stringify({ query, hitsPerPage: 6 }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Algolia request failed');
        const data = await response.json();
        const nextHits = (data.hits ?? []) as AlgoliaHit[];
        setHits(nextHits);
        setNoResults(nextHits.length === 0);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Algolia search failed', error);
        setHits([]);
        setNoResults(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query, algoliaConfig.appId, algoliaConfig.apiKey, algoliaConfig.indexName]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const firstResultUrl = hits[0]?.url;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (firstResultUrl) {
      window.location.href = firstResultUrl;
    }
  };

  const getTitle = (hit: AlgoliaHit) =>
    hit.hierarchy?.lvl2 || hit.hierarchy?.lvl1 || hit.hierarchy?.lvl0 || hit.content || hit.url;

  const getMeta = (hit: AlgoliaHit) => {
    if (hit.hierarchy?.lvl0) return hit.hierarchy.lvl0;
    try {
      return new URL(hit.url).hostname;
    } catch (error) {
      console.error(error);
      return hit.url;
    }
  };

  const getSnippet = (hit: AlgoliaHit) => {
    const snippet = hit._snippetResult?.content?.value;
    if (snippet) {
      return <span dangerouslySetInnerHTML={{ __html: snippet }} />;
    }
    return hit.content ?? '';
  };

  return (
    <div className={`navbar-search-wrapper ${isExpanded ? 'navbar-search-wrapper--active' : ''}`} ref={containerRef}>
      <form onSubmit={handleSubmit} className="search-input-shell">
        <span
          className="search-input-icon"
          aria-hidden="true"
          onClick={() => {
            if (!isExpanded) {
              setIsExpanded(true);
              setTimeout(() => inputRef.current?.focus(), 100);
            }
          }}
          style={{ cursor: isExpanded ? 'default' : 'pointer' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.65" y1="16.65" x2="21" y2="21" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search docs"
          className="search-input-field"
          autoComplete="off"
        />
        {query && (
          <button type="button" className="search-input-clear" onClick={clearSearch} aria-label="Clear search">
            ×
          </button>
        )}
        <button
          type="button"
          className="search-close-mobile"
          onClick={() => {
            setIsExpanded(false);
            clearSearch();
          }}
          aria-label="Close search"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </form>

      {isExpanded && (
        <div className="search-suggestions-panel">
          {loading && <div className="search-suggestions-empty">Searching…</div>}
          {!loading && noResults && <div className="search-suggestions-empty">No results found.</div>}
          {!loading && hits.length > 0 && (
            <ul className="search-suggestions-list">
              {hits.map((hit) => (
                <li key={hit.objectID} className="search-suggestions-item">
                  <a href={hit.url} target="_blank" rel="noreferrer">
                    <div className="search-suggestions-title">{getTitle(hit)}</div>
                    <div className="search-suggestions-snippet">{getSnippet(hit)}</div>
                    <div className="search-suggestions-meta">{getMeta(hit)}</div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
