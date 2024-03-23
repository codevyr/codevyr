'use client';

import Image from 'next/image'
import React, { createRef, use, useRef } from "react";
import { useCallback, useEffect, useState } from 'react';
import { Layout, Model, TabNode, IJsonModel } from 'flexlayout-react';
import { Editor, Monaco } from '@monaco-editor/react';
import monaco, { editor } from 'monaco-editor';
import { Uri } from 'monaco-editor/esm/vs/editor/editor.api';
import CytoscapeComponent from 'react-cytoscapejs';
import Cytoscape from 'cytoscape';

var json: IJsonModel = {
  global: { "tabEnableFloat": true },
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
                name: "query-editor",
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
                name: "graph-viewer",
                component: "button",
              }
            ]
          }
        ]
      },
      {
        type: "tabset",
        weight: 50,
        children: [
          {
            type: "tab",
            name: "Two",
            component: "button",
          }
        ]
      }
    ]
  }
};

const model = Model.fromJson(json);

interface EditorProps {
  query: string;
  onGraphChange: (graph: any) => void;
}

function EditorComponent({ query, onGraphChange }: EditorProps) {
  const askldUrl = 'api'

  const queryGraph = useCallback((ed: monaco.editor.ICodeEditor) => {
    console.log('submit-query');
    fetch(`${askldUrl}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: ed.getValue()
    }).then(response => response.json()
    ).then(data => {
      onGraphChange({
        nodes: data.nodes.map((node: string, index: number) => ({ data: { id: index, label: node } })),
        edges: data.edges.map((edge: Array<number>) => ({ data: { source: edge[0], target: edge[1], label: edge[2] } }))
      });
    });
  }, []);

  const handleEditorWillMount = (monaco: Monaco) => {
    monaco.editor.addEditorAction({
      id: 'submit-query',
      label: 'Submit Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: queryGraph
    });
  };

  return <Editor height="90vh" defaultLanguage="javascript" defaultValue={query} beforeMount={handleEditorWillMount} />;
}

interface Graph {
  nodes: Array<{ data: { id: number, label: string } }>;
  edges: Array<{ data: { source: number, target: number, label: string } }>;
}

interface GraphProps {
  graph: Graph;
}

function GraphViewer({ graph }: GraphProps) {
  let cyRef = useRef<Cytoscape.Core>(null);

  let layout = {
    name: 'breadthfirst',
    directed: true,
    fit: true,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    padding: 40
  };

  useEffect(() => {
    if (cyRef.current) {
      console.log('cyRef is', cyRef.current);
      cyRef.current.layout(layout).run();
    }
  }, [graph]);

  function cytoscapeHandler(cy: Cytoscape.Core) {
    cyRef.current = cy;

    function on(event: string, handler: (event: any) => void) {
      if (cyRef.current) {
        cyRef.current.on(event, handler);
      }
    }
  }

  return <CytoscapeComponent elements={CytoscapeComponent.normalizeElements(graph)} style={{ width: '100%', height: '100%' }} cy={cytoscapeHandler} layout={layout} />;
}

function GraphCode({ graph }: GraphProps) {
  return (<><ul>{graph.nodes.map(node => <li key={node.data.id}>{node.data.label}</li>)} </ul></>);
}

export default function Home() {
  const [query, setQuery] = useState('"create_srq" {}');
  const [graph, setGraph] = useState({ "nodes": [], "edges": [] });

  const factory = (node: TabNode) => {
    const component = node.getComponent();
    const name = node.getName();
    if (name === "query-editor") {
      return <EditorComponent query={query} onGraphChange={setGraph} />;
    } else if (name === "graph-viewer") {
      return <GraphViewer graph={graph} />;
    } else {
      return <GraphCode graph={graph} />;
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <Layout model={model} factory={factory} />
    </main>
  )
}
