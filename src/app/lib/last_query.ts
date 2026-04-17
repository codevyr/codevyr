const LAST_QUERY_KEY = 'askl-last-query';

export function readLastQuery(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LAST_QUERY_KEY);
}

export function writeLastQuery(query: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_QUERY_KEY, query);
}
