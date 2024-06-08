'use client';

import Image from 'next/image'
import React, { createRef, use, useMemo, useRef, useEffect, useState, useReducer } from 'react';
import { Layout, Model, TabNode, IJsonModel } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import { Editor, Monaco } from '@monaco-editor/react';
import monaco, { editor } from 'monaco-editor';
import { Uri } from 'monaco-editor/esm/vs/editor/editor.api';


import { EditorComponent } from './editor';
import { Graph, Node, Edge } from './graph';
import { CodeViewer, CodeFocus } from './code_viewer';
import { GraphViewer, GraphProps } from './graph_viewer';
import { on } from 'events';
import { makeServer } from "./mirage"

console.log(process.env.NODE_ENV, process.env.NEXT_PUBLIC_MIRAGE_DISABLE)
if (process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_MIRAGE_DISABLE) {
  console.log("Create mirage server")
  makeServer({ environment: "development" })
}

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
            name: "code-viewer",
            component: "button",
          },
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

  return (<>
    <ul>
      {Array.from(graph.nodes.entries()).map(([id, node]: [string, Node]) => <li key={id}>{get_str(node)}</li>)}
    </ul>
    <ul>
      {Array.from(graph.edges.values()).map((edge: Edge) => <li key={get_id(edge)}>{get_str(edge)}</li>)}
    </ul>
  </>);
}

export default function Home() {
  const [query, setQuery] = useState('"open_handle" {}');
  const [queryGraph, setQueryGraph] = useState<Graph>({ nodes: new Map(), edges: new Set() });
  const [codeFocus, setCodeFocus] = useState<CodeFocus | null>(null);

  const factory = (node: TabNode) => {
    const component = node.getComponent();
    const name = node.getName();
    switch (name) {
      case "query-editor":
        return <EditorComponent query={query} onGraphChange={setQueryGraph} />;
      case "graph-viewer":
        return <GraphViewer graph={queryGraph} onFocus={setCodeFocus} />;
      case "code-viewer":
        return <CodeViewer codeFocus={codeFocus} />;
      default:
        return <GraphCode graph={queryGraph} />;
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <Layout model={model} factory={factory} />
    </main>
  )
}
