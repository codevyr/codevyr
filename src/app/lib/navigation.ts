import type { OffsetValue } from './offsets';
import type { FileTreeCache } from './file_tree_cache';

type RevealFileOptions = {
  fileId: string;
  path?: string | null;
  projectId?: string | null;
  fileType?: string | null;
  startOffset?: OffsetValue;
  endOffset?: OffsetValue | null;
};

type RevealFileDeps = {
  cache: FileTreeCache;
  openFileById: (options: {
    fileId: string;
    filePath: string | null;
    startOffset: OffsetValue;
    endOffset?: OffsetValue | null;
    fileType?: string | null;
  }) => void;
};

export type RevealFileResult = {
  fileId: string;
  projectId: string | null;
  path: string | null;
};

export async function revealFile(options: RevealFileOptions, deps: RevealFileDeps): Promise<RevealFileResult> {
  const { fileId } = options;
  let resolvedPath = options.path ?? null;
  let resolvedProjectId = options.projectId ?? null;
  const needsResolve =
    !resolvedProjectId ||
    typeof resolvedPath !== 'string' ||
    !resolvedPath ||
    !resolvedPath.startsWith('/');

  if (needsResolve) {
    const resolved = await deps.cache.resolveFileLocation(fileId);
    if (resolved) {
      if (!resolvedProjectId) {
        resolvedProjectId = resolved.projectId;
      }
      if (typeof resolvedPath !== 'string' || !resolvedPath || !resolvedPath.startsWith('/')) {
        resolvedPath = resolved.path;
      }
    }
  }

  let ensurePromise: Promise<void> | null = null;
  if (resolvedProjectId && resolvedPath) {
    deps.cache.registerFileLocation(fileId, resolvedProjectId, resolvedPath);
    ensurePromise = deps.cache.ensurePath(resolvedProjectId, resolvedPath);
  }

  deps.openFileById({
    fileId,
    filePath: resolvedPath,
    startOffset: options.startOffset ?? 0,
    endOffset: options.endOffset ?? null,
    fileType: options.fileType ?? null,
  });

  await ensurePromise;
  return {
    fileId,
    projectId: resolvedProjectId ?? null,
    path: resolvedPath ?? null,
  };
}
