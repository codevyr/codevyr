export const ROOT_PATH = '/';

export function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, '/');
  if (normalized === ROOT_PATH) {
    return ROOT_PATH;
  }
  return normalized.replace(/\/+$/, '');
}

export function getBaseName(path: string) {
  const trimmed = path.replace(/\\/g, '/');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) {
    return trimmed || ROOT_PATH;
  }
  return segments[segments.length - 1];
}

export function buildAncestorPaths(path: string, includeSelf: boolean) {
  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter(Boolean);
  const dirPaths: string[] = [];
  let current = '';
  const limit = includeSelf ? segments.length : Math.max(segments.length - 1, 0);
  for (let index = 0; index < limit; index += 1) {
    current += `/${segments[index]}`;
    dirPaths.push(current);
  }
  return dirPaths;
}

export function isPathPrefix(prefix: string, target: string) {
  const normalizedPrefix = prefix.replace(/\\/g, '/').replace(/\/+$/, '') || ROOT_PATH;
  const normalizedTarget = target.replace(/\\/g, '/');
  if (normalizedPrefix === ROOT_PATH) {
    return normalizedTarget.startsWith(ROOT_PATH);
  }
  return normalizedTarget === normalizedPrefix || normalizedTarget.startsWith(`${normalizedPrefix}/`);
}
