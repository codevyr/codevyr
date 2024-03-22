'use client';

import Image from 'next/image'
import React, { createRef, use } from "react";
import { useCallback, useEffect, useState } from 'react';
import { Layout, Model, TabNode, IJsonModel } from 'flexlayout-react';
import { Editor, Monaco } from '@monaco-editor/react';
import monaco, {editor} from 'monaco-editor';
import {Uri} from 'monaco-editor/esm/vs/editor/editor.api';
import CytoscapeComponent from 'react-cytoscapejs';

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
  setGraph: (graph: any) => void;
}

function EditorComponent({ query, setGraph }: EditorProps) {
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
      // setGraph(data);
      console.log(data);
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

interface GraphProps {
  graph: string;
}

function GraphViewer({graph} : GraphProps) {
  let cyRef = createRef<CytoscapeComponent>();

  const elements = [
    { data: { id: 'one', label: 'Node 1' } },
    { data: { id: 'two', label: 'Node 2' }},
    { data: { source: 'one', target: 'two', label: 'Edge from Node1 to Node2' } }
  ];

  // useEffect(() => {
  //   if (cyRef) {
  //     console.log('cyRef', cyRef);
  //   }
  // }, [graph]);

  return <CytoscapeComponent elements={elements} style={{ width: '100%', height: '100%' }} cy={(cy: any) => { cyRef = cy }} />;
}

function GraphCode({graph} : GraphProps) {
  return <>
   </>;
}

export default function Home() {
  const [query, setQuery] = useState('"create_srq" {}');
  const [graph, setGraph] = useState({"nodes": [], "edges": []});

  const factory = (node: TabNode) => {
    const component = node.getComponent();
    const name = node.getName();
    if (name === "query-editor") {
      return <EditorComponent query={query} setGraph={setGraph} />;
    } else if (name === "graph-viewer") {
      return <GraphViewer graph={graph} />;
    } else {
      return <GraphCode graph={graph}/>;
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <Layout model={model} factory={factory} />
    </main>
  )
}
