import { useState } from 'react';

const STORAGE_KEY = 'askl-saved-queries';
const LAST_QUERY_KEY = 'askl-last-query';
const MAX_QUERIES = 10;

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  savedAt: number;
}

function deriveQueryName(query: string): string {
  const lines = query.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('#')) {
      return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed;
    }
  }
  return 'Untitled query';
}

function readFromStorage(): SavedQuery[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeToStorage(queries: SavedQuery[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
}

export function useSavedQueries() {
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => readFromStorage());

  function saveQuery(queryText: string): void {
    setSavedQueries(prev => {
      const existingIdx = prev.findIndex(q => q.query === queryText);
      let next: SavedQuery[];

      if (existingIdx !== -1) {
        // Duplicate — update timestamp and move to front, preserve custom name
        const existing = prev[existingIdx];
        next = [
          { ...existing, savedAt: Date.now() },
          ...prev.slice(0, existingIdx),
          ...prev.slice(existingIdx + 1),
        ];
      } else {
        const newEntry: SavedQuery = {
          id: typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()),
          name: deriveQueryName(queryText),
          query: queryText,
          savedAt: Date.now(),
        };
        next = [newEntry, ...prev].slice(0, MAX_QUERIES);
      }

      writeToStorage(next);
      return next;
    });
  }

  function renameQuery(id: string, newName: string): void {
    setSavedQueries(prev => {
      const next = prev.map(q => q.id === id ? { ...q, name: newName } : q);
      writeToStorage(next);
      return next;
    });
  }

  function deleteQuery(id: string): void {
    setSavedQueries(prev => {
      const next = prev.filter(q => q.id !== id);
      writeToStorage(next);
      return next;
    });
  }

  function clearAll(): void {
    writeToStorage([]);
    setSavedQueries([]);
  }

  return { savedQueries, saveQuery, renameQuery, deleteQuery, clearAll } as const;
}

export function readLastQuery(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LAST_QUERY_KEY);
}

export function writeLastQuery(query: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_QUERY_KEY, query);
}
