'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layout, Model, TabNode, IJsonModel, Actions, DockLocation, Action, TabSetNode } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import { EditorComponent } from './editor';
import { Graph, Node, Edge } from './graph';
import { CodeViewer, CodeFocus, EditorParams } from './code_viewer';
import { GraphViewer } from './graph_viewer';
import { makeServer } from "./mirage"
import { fetchSource } from "./askld";
import { DEFAULT_QUERY } from './default-queries';


const CODE_TABSET_ID = "code-tabset";
const CODE_PLACEHOLDER_TAB_ID = "code-placeholder";

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
              }
            ]
          },
          {
            type: "tabset",
            weight: 50,
            children: [
              {
                type: "tab",
                id: "graph-viewer",
                name: "Graph",
                component: "button",
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
}

function GraphCode({ graph }: GraphCodeProps) {
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

  function get_loc(edge: Edge): string {
    return edge.from_file + ":" + edge.from_line
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
  const [codeTabs, setCodeTabs] = useState<Map<string, CodeTabEntry>>(() => new Map());
  const codeTabsRef = useRef<Map<string, CodeTabEntry>>(codeTabs);

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef<string | null>(activeFileId);
  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  const handleSelectFile = useCallback((focus: CodeFocus) => {
    const { file_id: fileId, line } = focus;
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
        const isVisibleNow = isTabVisible(model, tabId);
        updated.set(tabId, {
          fileId: existing.fileId,
          title: tabTitle,
          editorParams: {
            ...existing.editorParams,
            path: filePath,
            loc: line,
            isVisible: () => isVisibleNow,
            // && isTabVisible(model, tabId)
          },
        });
        codeTabsRef.current = updated;
        return updated;
      });

      model.doAction(Actions.updateNodeAttributes(tabId, { name: tabTitle }));
      model.doAction(Actions.selectTab(tabId));
      setActiveFileId(fileId);
      return;
    }

    const isVisibleNow = isTabVisible(model, tabId);
    fetchSource(fileId)
      .then(response => response.text())
      .then(data => {
        const editorParams: EditorParams = {
          path: String(filePath),
          language: 'c',
          value: data,
          loc: line,
          isVisible: () => isVisibleNow,
          // && isTabVisible(model, tabId)
        };

        setCodeTabs(prev => {
          const next = new Map(prev);
          next.set(tabId, { fileId, title: tabTitle, editorParams });
          codeTabsRef.current = next;
          return next;
        });

        setActiveFileId(fileId);

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
  }, [model, queryGraph]);

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
        return <EditorComponent query={query} onGraphChange={setQueryGraph} />;
      case "graph-viewer":
        return <GraphViewer graph={queryGraph} selectFile={handleSelectFile} />;
      default:
        return <GraphCode graph={queryGraph} />;
    }
  }, [codeTabs, query, queryGraph, handleSelectFile]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <Layout model={model} factory={factory} onModelChange={handleModelChange} />
    </main>
  );
}
