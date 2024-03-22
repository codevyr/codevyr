'use client';

import Image from 'next/image'
import React from "react";
import { useCallback, useEffect, useState } from 'react';
import { Layout, Model, TabNode, IJsonModel } from 'flexlayout-react';
import Editor, { Monaco } from '@monaco-editor/react';

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
                name: "One",
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
                name: "Two",
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

function EditorComponent() {
  const [value, setValue] = useState('// some comment');
  const askldUrl = 'api'

  const handleEditorWillMount = (monaco: Monaco) => {
    monaco.editor.addEditorAction({
      id: 'submit-query',
      label: 'Submit Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: function (ed) {
        console.log('submit-query');
        fetch(`${askldUrl}/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain'
          },
          body: value
        })
        .then(response => response.text())
        .then(text =>{
          console.log("RESPONSE", text);
        })
      }
    });
  };

  return <Editor height="90vh" defaultLanguage="javascript" defaultValue={value} beforeMount={handleEditorWillMount} />;
}

const factory = (node: TabNode) => {
  const component = node.getComponent();
  const name = node.getName();
  if (name === "One") {
    return EditorComponent();
  } else if (name === "Two") {
    return <div>Contents of Tab #2</div>;
  }
  return null;
};

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <Layout model={model} factory={factory} />
    </main>
  )
}
