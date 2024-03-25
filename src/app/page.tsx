'use client';

import Image from 'next/image'
import React, { createRef, use, useMemo, useRef, useEffect, useState, useReducer } from 'react';
import { Layout, Model, TabNode, IJsonModel } from 'flexlayout-react';
import { Editor, Monaco } from '@monaco-editor/react';
import monaco, { editor } from 'monaco-editor';
import { Uri } from 'monaco-editor/esm/vs/editor/editor.api';
import CytoscapeComponent from 'react-cytoscapejs';
import Cytoscape, { ElementDefinition } from 'cytoscape';

import { EditorComponent } from './editor';
import { Graph, Node, Edge } from './graph';
import { CodeViewer, CodeFocus } from './code_viewer';
import { on } from 'events';

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

interface GraphProps {
  graph: Graph;
  onFocus: any;
}

function GraphViewer({ graph, onFocus }: GraphProps) {
  let cyRef = useRef<Cytoscape.Core | null>(null);

  const layout = useMemo(() => ({
    name: 'breadthfirst',
    directed: true,
    fit: true,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    padding: 40
  }), []);

  useEffect(() => {
    if (cyRef.current) {
      console.log('cyRef is', cyRef.current);
      cyRef.current.layout(layout).run();
    }
  }, [graph, layout]);

  function cytoscapeHandler(cy: Cytoscape.Core) {

    cyRef.current = cy;

    cy.off('tap', 'node');
    cy.on('tap', 'node', function (evt) {
      var node_id = evt.target.id();
      var node : Node | null = null;
      var count = 0;
      graph.nodes.forEach((n: Node) => {
        count += 1;
        if (n.id === node_id) {
          node = n;
          onFocus({
            uri: n.uri,
            loc: n.loc
          });
          console.log('node is', n, count);
        }
      });
    });
  }

  function cytoscapeElements(graph: Graph): ElementDefinition[] {
    console.log('graph is', graph);
    let elements: ElementDefinition[] = [];
    graph.nodes.forEach((node: Node) => {
      elements.push({ data: { id: node.id, label: node.label } });
    });

    graph.edges.forEach((edge: Edge) => {
      elements.push({ data: { id: edge.from + '-' + edge.to, source: edge.from, target: edge.to } });
    });

    return elements;
  }

  console.log('graph is', graph);
  return <CytoscapeComponent elements={cytoscapeElements(graph)} style={{ width: '100%', height: '100%' }} cy={cytoscapeHandler} layout={layout} />;
}

function GraphCode({ graph }: GraphProps) {
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
    {Array.from(graph.nodes).map((node: Node) => <li key={get_id(node)}>{get_str(node)}</li>)}
  </ul>
  <ul>
    {Array.from(graph.edges.values()).map((edge: Edge) => <li key={get_id(edge)}>{get_str(edge)}</li>)}
  </ul>
  </>);
}

export default function Home() {
  const [query, setQuery] = useState('"create_srq" {}');
  const [queryGraph, setQueryGraph] = useState<Graph>({ nodes: new Set(), edges: new Set() });
  const [codeFocus, setCodeFocus] = useState<CodeFocus|null>(null);

  const factory = (node: TabNode) => {
    const component = node.getComponent();
    const name = node.getName();
    switch (name) {
    case "query-editor":
      return <EditorComponent query={query} onGraphChange={setQueryGraph} />;
    case "graph-viewer":
      return <GraphViewer graph={queryGraph} onFocus={setCodeFocus} />;
    case "code-viewer":
      return <CodeViewer codeFocus={codeFocus}/>;
    default:
      return <GraphCode graph={queryGraph} onFocus={codeFocus} />;
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <Layout model={model} factory={factory} />
    </main>
  )
}
