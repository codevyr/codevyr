'use client';

import Image from 'next/image'
import React from "react";
import {Layout, Model, TabNode, IJsonModel} from 'flexlayout-react';
import Editor from '@monaco-editor/react';

var json : IJsonModel= {
  global: {"tabEnableFloat": true},
  borders: [],
  layout: {
      type: "row",
      weight: 100,
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
  }
};

const model = Model.fromJson(json);

const factory = (node: TabNode) => {
  const component = node.getComponent();
  const name = node.getName();
  if (name === "One") {
    return <Editor height="90vh" defaultLanguage="javascript" defaultValue="// some comment" />;
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
