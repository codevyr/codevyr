import React, { useCallback, useEffect, useRef } from "react";
import { Editor, Monaco } from '@monaco-editor/react';
import monaco from 'monaco-editor';
import { Node, Edge, Graph } from './graph';
import { setupEditorTestApis } from './testing/editor_test_utils';

import { fetchQuery } from './askld';
import { registerAskl } from './monaco-askl-language';

interface EditorProps {
    query: string;
    onGraphChange: (graph: Graph) => void;
}

interface RustGraph {
    nodes: Map<string, Node>;
    edges: Set<Edge>;
    files: Array<[string, string]>;
}

export function EditorComponent({ query, onGraphChange }: EditorProps) {
    const testCleanupRef = useRef<(() => void) | null>(null);
    const queryGraph = (ed: monaco.editor.ICodeEditor) => {
        console.log('submit-query');
        fetchQuery(ed.getValue())
            .then(response => response.json())
            .then((data: RustGraph) => {
                console.log('data is', data);
                let nodes = new Map<string, Node>()
                data.nodes.forEach((node) => {
                    nodes.set(node.id, node)
                })

                let files = new Map<string, string>()
                data.files.forEach(([file_id, file_path]) => {
                    files.set(file_id, file_path)
                });

                const edgeMap: Map<string, Array<Edge>> = new Map();

                data.edges.forEach(edge => {
                    if (!edgeMap.has(edge.id)) {
                        edgeMap.set(edge.id, []);
                    }
                    edgeMap.get(edge.id)!.push(edge);
                });

                console.log("FILES", files, edgeMap, nodes)
                onGraphChange(
                    { nodes: nodes, edges: edgeMap, files: files }
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

        registerAskl(monaco);
    };

    const handleEditorDidMount = useCallback((editorInstance: monaco.editor.IStandaloneCodeEditor) => {
        const cleanup = setupEditorTestApis(editorInstance);
        testCleanupRef.current = cleanup;
    }, []);

    useEffect(() => {
        return () => {
            if (testCleanupRef.current) {
                testCleanupRef.current();
                testCleanupRef.current = null;
            }
        };
    }, []);

    return <Editor height="90vh" defaultLanguage="askl" defaultValue={query} beforeMount={handleEditorWillMount} onMount={handleEditorDidMount} />;
}
