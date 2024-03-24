
import React from "react";
import useCallback from 'react';
import { Editor, Monaco } from '@monaco-editor/react';
import monaco from 'monaco-editor';
import { Node, Edge } from './graph';

interface EditorProps {
    query: string;
    onGraphChange: (graph: any) => void;
}

export function EditorComponent({ query, onGraphChange }: EditorProps) {
    const askldUrl = 'api'

    const queryGraph = (ed: monaco.editor.ICodeEditor) => {
        console.log('submit-query');
        fetch(`${askldUrl}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: ed.getValue()
        }).then(response => response.json()
        ).then(data => {
            console.log('data is', data);
            onGraphChange(
                { nodes: data.nodes, edges: data.edges}
            );
        });
    };

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