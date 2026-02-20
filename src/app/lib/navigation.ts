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

export async function revealFile(options: RevealFileOptions, deps: RevealFileDeps): Promise<void> {
  const { fileId } = options;
  let resolvedPath = options.path ?? null;
  let resolvedProjectId = options.projectId ?? null;
  const needsResolve = !resolvedProjectId || !resolvedPath || !resolvedPath.startsWith('/');

  if (needsResolve) {
    const resolved = await deps.cache.resolveFileLocation(fileId);
    if (resolved) {
      if (!resolvedProjectId) {
        resolvedProjectId = resolved.projectId;
      }
      if (!resolvedPath || !resolvedPath.startsWith('/')) {
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
}
