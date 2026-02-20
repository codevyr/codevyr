import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Actions,
  DockLocation,
  Model,
  TabNode,
  type Action,
} from 'flexlayout-react';
import { fetchSource } from '../askld';
import type { EditorParams } from '../code_viewer';
import type { OffsetValue } from './offsets';
import { resolveEditorLanguage } from './file_language';

export type CodeTabEntry = {
  fileId: string;
  title: string;
  editorParams: EditorParams;
};

type UseCodeTabsOptions = {
  model: Model;
  tabsetId: string;
  placeholderTabId: string;
};

type OpenFileOptions = {
  fileId: string;
  filePath: string | null;
  startOffset: OffsetValue;
  endOffset?: OffsetValue | null;
  fileType?: string | null;
};

const codeTabId = (fileId: string) => `code-tab-${fileId}`;

function getTabTitle(filePathOrId: string): string {
  const normalized = filePathOrId.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : normalized;
  const [basename] = lastSegment.split(':');
  return basename || lastSegment || filePathOrId;
}

function isTabVisible(model: Model, tabId: string): boolean {
  const node = model.getNodeById(tabId);
  if (!node || node.getType() !== 'tab') {
    return false;
  }

  const tab = node as TabNode;
  return tab.isVisible();
}

export function useCodeTabs({ model, tabsetId, placeholderTabId }: UseCodeTabsOptions) {
  const [codeTabs, setCodeTabs] = useState<Map<string, CodeTabEntry>>(() => new Map());
  const [fileContents, setFileContents] = useState<Map<string, string>>(() => new Map());
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const codeTabsRef = useRef<Map<string, CodeTabEntry>>(codeTabs);
  const fileContentsRef = useRef<Map<string, string>>(fileContents);
  const activeFileIdRef = useRef<string | null>(activeFileId);
  const pendingFileLoadsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    codeTabsRef.current = codeTabs;
  }, [codeTabs]);

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  const updateFileContents = useCallback((fileId: string, content: string) => {
    setFileContents((prev) => {
      if (prev.get(fileId) === content) {
        return prev;
      }
      const next = new Map(prev);
      next.set(fileId, content);
      fileContentsRef.current = next;
      return next;
    });
  }, []);

  const ensureFileContent = useCallback((fileId: string) => {
    if (fileContentsRef.current.has(fileId) || pendingFileLoadsRef.current.has(fileId)) {
      return;
    }

    pendingFileLoadsRef.current.add(fileId);
    fetchSource(fileId)
      .then((response) => response.text())
      .then((data) => {
        updateFileContents(fileId, data);
      })
      .catch((error) => {
        console.error('Failed to load source file', error);
      })
      .finally(() => {
        pendingFileLoadsRef.current.delete(fileId);
      });
  }, [updateFileContents]);

  const openFileById = useCallback(({
    fileId,
    filePath,
    startOffset,
    endOffset,
    fileType,
  }: OpenFileOptions) => {
    const tabId = codeTabId(fileId);
    const existingEntry = codeTabsRef.current.get(tabId);
    const resolvedPath = filePath ?? fileId;
    const tabTitle = getTabTitle(resolvedPath);
    const language = resolveEditorLanguage(resolvedPath, fileType ?? null);

    if (existingEntry) {
      setCodeTabs((prev) => {
        const existing = prev.get(tabId);
        if (!existing) {
          return prev;
        }

        const updated = new Map(prev);
        updated.set(tabId, {
          fileId: existing.fileId,
          title: tabTitle,
          editorParams: {
            ...existing.editorParams,
            path: resolvedPath,
            language,
            focusStartOffset: startOffset,
            focusEndOffset: endOffset ?? null,
            isVisible: () => isTabVisible(model, tabId),
          },
        });
        codeTabsRef.current = updated;
        return updated;
      });

      model.doAction(Actions.updateNodeAttributes(tabId, { name: tabTitle }));
      model.doAction(Actions.selectTab(tabId));
      setActiveFileId(fileId);
      updateFileContents(fileId, existingEntry.editorParams.value);
      return;
    }

    fetchSource(fileId)
      .then((response) => response.text())
      .then((data) => {
        const editorParams: EditorParams = {
          path: String(resolvedPath),
          language,
          value: data,
          focusStartOffset: startOffset,
          focusEndOffset: endOffset ?? null,
          isVisible: () => isTabVisible(model, tabId),
        };

        setCodeTabs((prev) => {
          const next = new Map(prev);
          next.set(tabId, { fileId, title: tabTitle, editorParams });
          codeTabsRef.current = next;
          return next;
        });

        setActiveFileId(fileId);
        updateFileContents(fileId, data);

        const newTab = {
          type: 'tab',
          id: tabId,
          name: tabTitle,
          component: 'code-viewer',
          config: { fileId },
        };

        model.doAction(Actions.addNode(newTab, tabsetId, DockLocation.CENTER, -1, true));

        if (model.getNodeById(placeholderTabId)) {
          model.doAction(Actions.deleteTab(placeholderTabId));
        }
      })
      .catch((error) => {
        console.error('Failed to load source file', error);
      });
  }, [model, placeholderTabId, tabsetId, updateFileContents]);

  const handleModelChange = useCallback((_: Model, action: Action) => {
    if (action.type === Actions.SELECT_TAB) {
      const tabId = action.data.tabNode;
      if (typeof tabId === 'string') {
        const entry = codeTabsRef.current.get(tabId);
        if (entry) {
          setActiveFileId(entry.fileId);
        } else if (tabId === placeholderTabId) {
          setActiveFileId(null);
        }
      }
    }

    if (action.type === Actions.DELETE_TAB) {
      const tabId = action.data.node;
      if (typeof tabId === 'string') {
        const entry = codeTabsRef.current.get(tabId);
        if (entry) {
          setCodeTabs((prev) => {
            if (!prev.has(tabId)) {
              return prev;
            }
            const next = new Map(prev);
            next.delete(tabId);
            if (next.size === 0 && !model.getNodeById(placeholderTabId)) {
              const placeholderTab = {
                type: 'tab',
                id: placeholderTabId,
                name: 'Code',
                component: 'code-placeholder',
                enableClose: false,
              };
              model.doAction(Actions.addNode(placeholderTab, tabsetId, DockLocation.CENTER, -1, false));
            }
            codeTabsRef.current = next;
            return next;
          });

          if (activeFileIdRef.current === entry.fileId) {
            setActiveFileId(null);
          }
        }
      }
    }
  }, [model, placeholderTabId, tabsetId]);

  return {
    codeTabs,
    codeTabsRef,
    fileContents,
    fileContentsRef,
    activeFileId,
    openFileById,
    ensureFileContent,
    handleModelChange,
  };
}
