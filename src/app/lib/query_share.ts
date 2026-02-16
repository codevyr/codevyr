import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

export function encodeQuery(query: string) {
  return compressToEncodedURIComponent(query);
}

export function decodeQuery(encoded: string) {
  const result = decompressFromEncodedURIComponent(encoded);
  return result === null ? null : result;
}

export function buildShareUrl(query: string, baseUrl?: string) {
  const encoded = encodeQuery(query);
  const base =
    baseUrl ??
    (typeof window === 'undefined'
      ? ''
      : `${window.location.origin}${window.location.pathname}${window.location.search}`);
  return `${base}#q=${encoded}`;
}

export function getQueryFromHash(hash: string) {
  if (!hash || !hash.startsWith('#q=')) {
    return null;
  }
  const encoded = hash.slice(3);
  return decodeQuery(encoded);
}
