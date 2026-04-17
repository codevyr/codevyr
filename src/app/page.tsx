'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layout, Model, TabNode, type IJsonModel, Actions } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import { EditorComponent, EditorHandle } from './editor';
import { Graph, GraphObject, Node, Edge } from './graph';
import { CodeViewer, CodeFocus } from './code_viewer';
import { GraphViewer, type GraphViewerHandle } from './graph_viewer';
import { DEFAULT_QUERY } from './default-queries';
import { Problems, Problem } from './problems';
import { formatOffsetLocation, getLineColumnFromOffset } from './lib/offsets';
import { UnifiedToolbar, type ShareStatus } from './unified_toolbar';
import { readLastQuery } from './lib/last_query';
import { buildShareUrl, getQueryFromHash } from './lib/query_share';
import { FileExplorer } from './file_explorer';
import { useFileTreeCache } from './lib/file_tree_cache';
import { revealFile } from './lib/navigation';
import { useCodeTabs } from './lib/use_code_tabs';
import { copyToClipboard } from './lib/clipboard';
import { saveQueryToFile, openQueryFromFile } from './lib/file_io';
import { useInteractionMode, type InteractionMode } from './lib/use_interaction_mode';


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
        type: "tabset",
        id: "explorer-tabset",
        weight: 20,
        enableDeleteWhenEmpty: false,
        children: [
          {
            type: "tab",
            id: "file-explorer",
            name: "Explorer",
            component: "file-explorer",
            enableClose: false,
          }
        ]
      },
      {
        type: "row",
        weight: 40,
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
        weight: 40,
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

  function resolveEdgeObjectId(edge: Edge): string | null {
    if (edge.from_object) {
      return edge.from_object;
    }

    const node = graph.nodes.get(edge.from);
    return node?.symbol_instances[0]?.object_id ?? null;
  }

  function get_loc(edge: Edge): string {
    const objectId = resolveEdgeObjectId(edge);
    const filePath = objectId ? graph.objects.get(objectId)?.path ?? objectId : 'Unknown';
    const location = formatOffsetLocation(objectId ? fileContents.get(objectId) : undefined, edge.from_offset_start);
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

export default function Home() {
  const [model] = useState(() => Model.fromJson(initialLayout));
  const [query, setQuery] = useState(() => readLastQuery() ?? DEFAULT_QUERY);
  const [queryGraph, setQueryGraph] = useState<Graph>({
    nodes: new Map<string, Node>(),
    edges: new Map<string, Array<Edge>>(),
    has_edges: [],
    objects: new Map<string, GraphObject>(),
  });
  const [problems, setProblems] = useState<Problem[]>([]);
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const graphViewerRef = useRef<GraphViewerHandle>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');
  const [mode, setMode] = useState<InteractionMode>('hand');
  const [autoMerge, setAutoMerge] = useState(true);
  const { effectiveMode, panOnDrag, selectionOnDrag } = useInteractionMode(mode, setMode);
  const shareResetTimeoutRef = useRef<number | null>(null);
  const [explorerReveal, setExplorerReveal] = useState<{
    fileId: string;
    projectId: string;
    path: string;
    nonce: number;
  } | null>(null);

  const fileTreeCache = useFileTreeCache();
  const {
    codeTabs,
    codeTabsRef,
    fileContents,
    activeFileId,
    activeFileNonce,
    openFileById,
    ensureFileContent,
    handleModelChange,
  } = useCodeTabs({
    model,
    tabsetId: CODE_TABSET_ID,
    placeholderTabId: CODE_PLACEHOLDER_TAB_ID,
  });

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
  }, [query]);

  const handleRunQuery = useCallback(() => {
    editorHandleRef.current?.runQuery();
  }, []);

  const handleSaveToFile = useCallback(async () => {
    const currentQuery = editorHandleRef.current?.getQuery() ?? '';
    if (currentQuery.trim()) {
      await saveQueryToFile(currentQuery);
    }
  }, []);

  const handleOpenFromFile = useCallback(async () => {
    const content = await openQueryFromFile();
    if (content !== null) {
      editorHandleRef.current?.setQuery(content);
    }
  }, []);

  // Ctrl+S → save to file, Ctrl+O → open from file
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // Skip if focus is in Monaco editor (it handles its own shortcuts)
      const el = e.target as HTMLElement;
      if (el?.closest('.monaco-editor')) return;

      if (e.key === 's') {
        e.preventDefault();
        handleSaveToFile();
      } else if (e.key === 'o') {
        e.preventDefault();
        handleOpenFromFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveToFile, handleOpenFromFile]);

  const handleSelectFile = useCallback((focus: CodeFocus) => {
    const { object_id: objectId, start_offset: startOffset, end_offset: endOffset } = focus;
    const objectInfo = queryGraph.objects.get(objectId);
    const filePath = objectInfo?.path ?? null;
    const projectId = objectInfo?.project_id ?? null;
    void revealFile(
      { fileId: objectId, path: filePath, projectId, startOffset, endOffset: endOffset ?? null },
      { cache: fileTreeCache, openFileById },
    ).then((resolved) => {
      if (!resolved.projectId || !resolved.path) {
        return;
      }
      setExplorerReveal({
        fileId: resolved.fileId,
        projectId: resolved.projectId,
        path: resolved.path,
        nonce: Date.now(),
      });
    });
  }, [fileTreeCache, openFileById, queryGraph]);

  const handleRevealDirectory = useCallback((objectId: string) => {
    const objectInfo = queryGraph.objects.get(objectId);
    const filePath = objectInfo?.path ?? null;
    const projectId = objectInfo?.project_id ?? null;
    if (!projectId || !filePath) return;
    fileTreeCache.registerFileLocation(objectId, projectId, filePath);
    void fileTreeCache.ensurePath(projectId, filePath).then(() => {
      // Also load the directory's own children so it expands with contents
      fileTreeCache.loadDirectory(projectId, filePath);
      setExplorerReveal({
        fileId: objectId,
        projectId,
        path: filePath,
        nonce: Date.now(),
      });
    });
  }, [fileTreeCache, queryGraph]);

  const handleRevealQueryRange = useCallback((start: number, end: number) => {
    const queryText = editorHandleRef.current?.getQuery() ?? '';
    const startPos = getLineColumnFromOffset(queryText, start);
    const endPos = getLineColumnFromOffset(queryText, end);
    if (startPos && endPos) {
      editorHandleRef.current?.revealRange({
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
      });
    }
  }, []);

  const handleOpenFileFromExplorer = useCallback((fileId: string, filePath: string, projectId: string, fileType?: string | null) => {
    void revealFile(
      { fileId, path: filePath, projectId, fileType: fileType ?? null, startOffset: 0, endOffset: null },
      { cache: fileTreeCache, openFileById },
    ).then((resolved) => {
      if (!resolved.projectId || !resolved.path) {
        return;
      }
      setExplorerReveal({
        fileId: resolved.fileId,
        projectId: resolved.projectId,
        path: resolved.path,
        nonce: Date.now(),
      });
    });
  }, [fileTreeCache, openFileById]);

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
          <EditorComponent
            ref={editorHandleRef}
            query={query}
            onGraphChange={setQueryGraph}
            onProblemsChange={handleProblemsChange}
          />
        );
      case "file-explorer":
        return (
          <FileExplorer
            cache={fileTreeCache}
            activeFileId={activeFileId}
            activeFileNonce={activeFileNonce}
            revealRequest={explorerReveal}
            onOpenFile={handleOpenFileFromExplorer}
          />
        );
      case "graph-viewer":
        return (
          <GraphViewer
            ref={graphViewerRef}
            graph={queryGraph}
            selectFile={handleSelectFile}
            fileContents={fileContents}
            ensureFileContent={ensureFileContent}
            revealDirectory={handleRevealDirectory}
            revealQueryRange={handleRevealQueryRange}
            autoMerge={autoMerge}
            effectiveMode={effectiveMode}
            panOnDrag={panOnDrag}
            selectionOnDrag={selectionOnDrag}
          />
        );
      case PROBLEMS_TAB_ID:
        return <Problems problems={problems} onSelectProblem={handleProblemSelect} />;
      default:
        return <GraphCode graph={queryGraph} fileContents={fileContents} />;
    }
  }, [activeFileId, activeFileNonce, autoMerge, codeTabs, codeTabsRef, effectiveMode, ensureFileContent, explorerReveal, fileContents, fileTreeCache, handleOpenFileFromExplorer, handleProblemSelect, handleProblemsChange, handleRevealDirectory, handleRevealQueryRange, handleSelectFile, panOnDrag, problems, query, queryGraph, selectionOnDrag]);

  return (
    <main className="flex h-screen flex-col">
      <UnifiedToolbar
        onRunQuery={handleRunQuery}
        onSaveToFile={handleSaveToFile}
        onOpenFromFile={handleOpenFromFile}
        onShare={handleShare}
        shareStatus={shareStatus}
        onGraphAction={(action) => {
          const instance = graphViewerRef.current;
          if (instance) action(instance);
        }}
        mode={mode}
        onModeChange={setMode}
        autoMerge={autoMerge}
        onAutoMergeChange={setAutoMerge}
        hasGraph={queryGraph.nodes.size > 0}
      />
      <div className="flex-1 min-h-0 relative">
        <Layout model={model} factory={factory} onModelChange={handleModelChange} />
      </div>
    </main>
  );
}
