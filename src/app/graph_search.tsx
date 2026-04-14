import React, { type RefObject } from 'react';
import { LuSearch, LuChevronUp, LuChevronDown, LuX } from 'react-icons/lu';

interface GraphSearchBarProps {
  query: string;
  setQuery: (query: string) => void;
  matches: string[];
  currentIndex: number;
  goToNext: () => void;
  goToPrevious: () => void;
  close: () => void;
  inputRef: RefObject<HTMLInputElement>;
}

export function GraphSearchBar({
  query,
  setQuery,
  matches,
  currentIndex,
  goToNext,
  goToPrevious,
  close,
  inputRef,
}: GraphSearchBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      goToPrevious();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      goToNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const countLabel = query
    ? matches.length > 0
      ? `${currentIndex + 1} of ${matches.length}`
      : 'No results'
    : '';

  return (
    <div className="graph-search-bar">
      <LuSearch className="w-4 h-4 text-gray-400" />
      <input
        ref={inputRef}
        type="text"
        className="graph-search-input"
        placeholder="Search nodes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {countLabel && <span className="graph-search-count">{countLabel}</span>}
      <button
        className="graph-search-nav-btn"
        title="Previous (Shift+Enter)"
        onClick={goToPrevious}
        disabled={matches.length === 0}
      >
        <LuChevronUp className="w-4 h-4" />
      </button>
      <button
        className="graph-search-nav-btn"
        title="Next (Enter)"
        onClick={goToNext}
        disabled={matches.length === 0}
      >
        <LuChevronDown className="w-4 h-4" />
      </button>
      <button
        className="graph-search-nav-btn"
        title="Close (Escape)"
        onClick={close}
      >
        <LuX className="w-4 h-4" />
      </button>
    </div>
  );
}
