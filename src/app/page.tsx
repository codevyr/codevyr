'use client';

import Image from 'next/image'
import React, { createRef, use, useRef } from "react";
import { useCallback, useEffect, useState } from 'react';
import { Layout, Model, TabNode, IJsonModel } from 'flexlayout-react';
import { Editor, Monaco } from '@monaco-editor/react';
import monaco, { editor } from 'monaco-editor';
import { Uri } from 'monaco-editor/esm/vs/editor/editor.api';
import CytoscapeComponent from 'react-cytoscapejs';
import Cytoscape, { ElementDefinition } from 'cytoscape';

import { EditorComponent } from './editor';
import { Graph } from './graph';

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

interface GraphProps {
  graph: ElementDefinition[];
}

function GraphViewer({ graph }: GraphProps) {
  let cyRef = useRef<Cytoscape.Core | null>(null);

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

    cy.on('tap', 'node', function (evt) {
      var node = evt.target;
      console.log('tapped ' + node.id());
    });
  }

  console.log('graph is', graph);
  return <CytoscapeComponent elements={CytoscapeComponent.normalizeElements(graph)} style={{ width: '100%', height: '100%' }} cy={cytoscapeHandler} layout={layout} />;
}

function GraphCode({ graph }: GraphProps) {
  function get_id(data: any) {
    if ('id' in data) {
      return data.id;
    } else {
      return data.source + '-' + data.target;
    }
  }

  function get_str(data: any) {
    if ('label' in data) {
      return data.label;
    } else {
      return data.source + ' -> ' + data.target;
    }
  }

  return (<><ul>{graph.map(node => <li key={get_id(node.data)}>{get_str(node.data)}</li>)} </ul></>);
}

export default function Home() {
  const [query, setQuery] = useState('"create_srq" {}');
  const [graph, setGraph] = useState([]);

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
