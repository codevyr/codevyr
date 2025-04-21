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
import { CodeViewer, CodeFocus, EditorParams } from './code_viewer';
import { GraphViewer, GraphProps } from './graph_viewer';
import { on } from 'events';
import { makeServer } from "./mirage"
import { fetchSource } from "./askld";

console.log(process.env.NODE_ENV, process.env.NEXT_PUBLIC_MIRAGE_DISABLE)
if (process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_MIRAGE_DISABLE) {
  console.log("Create mirage server")
  makeServer({ environment: "development" })
}

var json: IJsonModel = {
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
        weight: 50,
        children: [
          {
            type: "tab",
            id: "code-viewer",
            name: "Code",
            component: "button",
          },
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

export default function Home() {
  const [query, setQuery] = useState('"devicemanager.Allocate" {}');
  const [queryGraph, setQueryGraph] = useState<Graph>({ nodes: new Map(), edges: new Map(), files: new Map() });
  const [codeFocus, setCodeFocus] = useState<CodeFocus | null>(null);
  const [currentFile, setCurrentFile] = useState<EditorParams>(new EditorParams());
  const [openFiles, setOpenFiles] = useState<Map<string, EditorParams>>(new Map());

  function handleSelectFile(codeFocus: CodeFocus) {
    let known_file = openFiles.get(codeFocus.file_id)
    if (known_file !== undefined) {
      console.log("File is known", codeFocus.file_id, known_file)
      setCurrentFile({
        language: known_file.language,
        loc: codeFocus.line,
        path: known_file.path,
        value: known_file.value,
      })
      openFiles.set(codeFocus.file_id, known_file)
      return;
    }

    fetchSource(codeFocus.file_id).then(response => response.text()).then(data => {
      const editor_params: EditorParams = {
        path: String(codeFocus.file_id),
        language: 'c',
        value: data,
        loc: codeFocus.line
      };


      setCurrentFile(editor_params)
      openFiles.set(codeFocus.file_id, editor_params)
    })
  }

  const factory = (node: TabNode) => {
    switch (node.getId()) {
      case "query-editor":
        return <EditorComponent query={query} onGraphChange={setQueryGraph} />;
      case "graph-viewer":
        return <GraphViewer graph={queryGraph} selectFile={handleSelectFile} />;
      case "code-viewer":
        return <CodeViewer editorParams={currentFile} />;
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
