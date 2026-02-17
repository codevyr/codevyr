'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layout, Model, TabNode, IJsonModel, Actions, DockLocation, Action, TabSetNode } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import { EditorComponent, EditorHandle } from './editor';
import { Graph, Node, Edge } from './graph';
import { CodeViewer, CodeFocus, EditorParams } from './code_viewer';
import { GraphViewer } from './graph_viewer';
import { makeServer } from "./mirage"
import { fetchSource } from "./askld";
import { DEFAULT_QUERY } from './default-queries';
import { Problems, Problem } from './problems';
import { formatOffsetLocation } from './lib/offsets';
import { QueryToolbar, ShareStatus } from './query_toolbar';
import { buildShareUrl, getQueryFromHash } from './lib/query_share';


const CODE_TABSET_ID = "code-tabset";
const INFO_TABSET_ID = "info-tabset";
const CODE_PLACEHOLDER_TAB_ID = "code-placeholder";
const PROBLEMS_TAB_ID = "problems-tab";

const initialLayout: IJsonModel = {
  global: { tabEnableDrag: true },
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "row",
        weight: 50,
        children: [
          {
            type: "tabset",
            weight: 50,
            children: [
              {
                type: "tab",
                id: "query-editor",
                name: "Query",
                component: "button",
                enableClose: false,
              }
            ]
          },
          {
            type: "tabset",
            id: INFO_TABSET_ID,
            weight: 50,
            children: [
              {
                type: "tab",
                id: "graph-viewer",
                name: "Graph",
                component: "button",
                enableClose: false,
              },
              {
                type: "tab",
                id: PROBLEMS_TAB_ID,
                name: "Problems",
                component: "button",
                enableClose: false,
              },
              {
                type: "tab",
                id: "Two",
                name: "Nodes",
                component: "button",
              }
            ]
          }
        ]
      },
      {
        type: "tabset",
        id: CODE_TABSET_ID,
        weight: 50,
        enableDeleteWhenEmpty: false,
        children: [
          {
            type: "tab",
            id: CODE_PLACEHOLDER_TAB_ID,
            name: "Code",
            component: "code-placeholder",
            enableClose: false,
          }
        ]
      }
    ]
  }
};

export interface GraphCodeProps {
  graph: Graph;
  fileContents: Map<string, string>;
}

function GraphCode({ graph, fileContents }: GraphCodeProps) {
  function get_id(data: any) {
    if ('id' in data) {
      return data.id;
    } else {
      return data.from + '-' + data.to;
    }
  }

  function get_str(data: any) {
    if ('label' in data) {
      return data.label;
    } else {
      return data.from + ' -> ' + data.to;
    }
  }

  function resolveEdgeFileId(edge: Edge): string | null {
    if (edge.from_file) {
      return edge.from_file;
    }

    const node = graph.nodes.get(edge.from);
    return node?.declarations[0]?.file_id ?? null;
  }

  function get_loc(edge: Edge): string {
    const fileId = resolveEdgeFileId(edge);
    const filePath = fileId ? graph.files.get(fileId) ?? fileId : 'Unknown';
    const location = formatOffsetLocation(fileId ? fileContents.get(fileId) : undefined, edge.from_offset_start);
    return `${filePath}:${location}`;
  }

  return (<>
    <ul>
      {Array.from(graph.nodes.entries()).map(([id, node]: [string, Node]) => <li key={id}>{get_str(node)}</li>)}
    </ul>
    <ul>
      {
        Array.from(graph.edges.values()).map((edgeArray: Array<Edge>) =>
          <li key={get_id(edgeArray[0])}>{get_str(edgeArray[0])}
            <ul>
              {edgeArray.map((edge: Edge) => <li key={get_loc(edge)}> {get_loc(edge)} </li>)}
            </ul>
          </li>)}
    </ul>
  </>);
}

const codeTabId = (fileId: string) => `code-tab-${fileId}`;

interface CodeTabEntry {
  fileId: string;
  title: string;
  editorParams: EditorParams;
}

function getTabTitle(filePathOrId: string): string {
  const normalized = filePathOrId.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : normalized;
  const [basename] = lastSegment.split(':');
  return basename || lastSegment || filePathOrId;
}

function isTabVisible(model: Model, tabId: string): boolean {
    const node = model.getNodeById(tabId);
    if (!node || node.getType() !== "tab") return false;

    const tab = node as TabNode;
    return tab.isVisible();
}

export default function Home() {
  const [model] = useState(() => Model.fromJson(initialLayout));
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [queryGraph, setQueryGraph] = useState<Graph>({ nodes: new Map(), edges: new Map(), files: new Map() });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [codeTabs, setCodeTabs] = useState<Map<string, CodeTabEntry>>(() => new Map());
  const [fileContents, setFileContents] = useState<Map<string, string>>(() => new Map());
  const codeTabsRef = useRef<Map<string, CodeTabEntry>>(codeTabs);
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const fileContentsRef = useRef<Map<string, string>>(fileContents);
  const pendingFileLoadsRef = useRef<Set<string>>(new Set());
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');
  const shareResetTimeoutRef = useRef<number | null>(null);

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef<string | null>(activeFileId);
  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);
  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyQueryFromHash = () => {
      const decoded = getQueryFromHash(window.location.hash);
      if (decoded === null) {
        return;
      }
      setQuery(decoded);
    };

    applyQueryFromHash();
    window.addEventListener('hashchange', applyQueryFromHash);
    return () => {
      window.removeEventListener('hashchange', applyQueryFromHash);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (shareResetTimeoutRef.current !== null) {
        window.clearTimeout(shareResetTimeoutRef.current);
      }
    };
  }, []);

  const handleProblemsChange = useCallback((nextProblems: Problem[]) => {
    setProblems(nextProblems);
    const problemCount = nextProblems.length;
    const tabNode = model.getNodeById(PROBLEMS_TAB_ID);
    if (!tabNode) {
      return;
    }

    model.doAction(
      Actions.updateNodeAttributes(PROBLEMS_TAB_ID, {
        name: problemCount > 0 ? `Problems (${problemCount})` : 'Problems',
        className: problemCount > 0 ? 'problems-tab-alert' : null,
      })
    );
  }, [model]);

  const handleProblemSelect = useCallback((problem: Problem) => {
    if (!problem.range) {
      return;
    }

    editorHandleRef.current?.revealRange(problem.range);
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        console.warn('Clipboard write failed, falling back', error);
      }
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (error) {
      console.warn('Clipboard fallback failed', error);
      return false;
    }
  }, []);

  const handleShare = useCallback(async () => {
    const currentQuery = editorHandleRef.current?.getQuery() ?? query;
    const shareUrl = buildShareUrl(currentQuery);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', shareUrl);
    }
    const didCopy = await copyToClipboard(shareUrl);
    setShareStatus(didCopy ? 'copied' : 'error');
    if (shareResetTimeoutRef.current !== null) {
      window.clearTimeout(shareResetTimeoutRef.current);
    }
    shareResetTimeoutRef.current = window.setTimeout(() => {
      setShareStatus('idle');
    }, 2000);
  }, [copyToClipboard, query]);

  const handleRunQuery = useCallback(() => {
    editorHandleRef.current?.runQuery();
  }, []);

  const updateFileContents = useCallback((fileId: string, content: string) => {
    setFileContents(prev => {
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
      .then(response => response.text())
      .then(data => {
        updateFileContents(fileId, data);
      })
      .catch(error => {
        console.error('Failed to load source file', error);
      })
      .finally(() => {
        pendingFileLoadsRef.current.delete(fileId);
      });
  }, [updateFileContents]);

  const handleSelectFile = useCallback((focus: CodeFocus) => {
    const { file_id: fileId, start_offset: startOffset, end_offset: endOffset } = focus;
    const tabId = codeTabId(fileId);
    const existingEntry = codeTabsRef.current.get(tabId);
    const filePath = queryGraph.files.get(fileId) ?? fileId;
    const tabTitle = getTabTitle(filePath);

    if (existingEntry) {
      setCodeTabs(prev => {
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
            path: filePath,
            focusStartOffset: startOffset,
            focusEndOffset: endOffset ?? null,
            isVisible: () => isTabVisible(model, tabId),
            // && isTabVisible(model, tabId)
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
      .then(response => response.text())
      .then(data => {
        const editorParams: EditorParams = {
          path: String(filePath),
          language: 'c',
          value: data,
          focusStartOffset: startOffset,
          focusEndOffset: endOffset ?? null,
          isVisible: () => isTabVisible(model, tabId),
          // && isTabVisible(model, tabId)
        };

        setCodeTabs(prev => {
          const next = new Map(prev);
          next.set(tabId, { fileId, title: tabTitle, editorParams });
          codeTabsRef.current = next;
          return next;
        });

        setActiveFileId(fileId);
        updateFileContents(fileId, data);

        const newTab = {
          type: "tab",
          id: tabId,
          name: tabTitle,
          component: "code-viewer",
          config: { fileId },
        };

        model.doAction(Actions.addNode(newTab, CODE_TABSET_ID, DockLocation.CENTER, -1, true));

        if (model.getNodeById(CODE_PLACEHOLDER_TAB_ID)) {
          model.doAction(Actions.deleteTab(CODE_PLACEHOLDER_TAB_ID));
        }
      })
      .catch(error => {
        console.error('Failed to load source file', error);
      });
  }, [model, queryGraph, updateFileContents]);

  const handleModelChange = useCallback((_: Model, action: Action) => {
    if (action.type === Actions.SELECT_TAB) {
      const tabId = action.data.tabNode;
      if (typeof tabId === 'string') {
        const entry = codeTabsRef.current.get(tabId);
        if (entry) {
          setActiveFileId(entry.fileId);
        } else if (tabId === CODE_PLACEHOLDER_TAB_ID) {
          setActiveFileId(null);
        }
      }
    }

    if (action.type === Actions.DELETE_TAB) {
      const tabId = action.data.node;
      if (typeof tabId === 'string') {
        const entry = codeTabsRef.current.get(tabId);
        if (entry) {
          setCodeTabs(prev => {
            if (!prev.has(tabId)) {
              return prev;
            }
            const next = new Map(prev);
            next.delete(tabId);
            if (next.size === 0 && !model.getNodeById(CODE_PLACEHOLDER_TAB_ID)) {
              const placeholderTab = {
                type: "tab",
                id: CODE_PLACEHOLDER_TAB_ID,
                name: "Code",
                component: "code-placeholder",
                enableClose: false,
              };
              model.doAction(Actions.addNode(placeholderTab, CODE_TABSET_ID, DockLocation.CENTER, -1, false));
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
  }, [model]);

  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent();
    if (component === "code-viewer") {
      const entry = codeTabs.get(node.getId()) ?? codeTabsRef.current.get(node.getId());
      if (!entry) {
        return <div className="p-4 text-sm text-muted">Loading file…</div>;
      }
      return <CodeViewer editorParams={entry.editorParams} />;
    }

    if (component === "code-placeholder") {
      return (
        <div className="p-6 text-sm text-muted">
          Select a node from the graph to open its source code.
        </div>
      );
    }

    switch (node.getId()) {
      case "query-editor":
        return (
          <div className="flex flex-col h-full">
            <QueryToolbar onRunQuery={handleRunQuery} onShare={handleShare} status={shareStatus} />
            <div className="flex-1">
              <EditorComponent
                ref={editorHandleRef}
                query={query}
                onGraphChange={setQueryGraph}
                onProblemsChange={handleProblemsChange}
              />
            </div>
          </div>
        );
      case "graph-viewer":
        return (
          <GraphViewer
            graph={queryGraph}
            selectFile={handleSelectFile}
            fileContents={fileContents}
            ensureFileContent={ensureFileContent}
          />
        );
      case PROBLEMS_TAB_ID:
        return <Problems problems={problems} onSelectProblem={handleProblemSelect} />;
      default:
        return <GraphCode graph={queryGraph} fileContents={fileContents} />;
    }
  }, [codeTabs, query, queryGraph, handleSelectFile, problems, handleProblemsChange, handleProblemSelect, fileContents, ensureFileContent, handleShare, shareStatus, handleRunQuery]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <Layout model={model} factory={factory} onModelChange={handleModelChange} />
    </main>
  );
}
