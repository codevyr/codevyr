import { useEffect, useRef, useState } from "react";
import { Editor, Monaco } from "@monaco-editor/react";
import monaco from 'monaco-editor';

export interface CodeFocus {
    file_id: string;
    line: string;
}

export interface CodeViewerProps {
    editorParams: EditorParams;
}

export class EditorParams {
    path: string = "";
    language: string = "";
    value: string = "";
    loc: string = "";
}

export function CodeViewer({ editorParams }: CodeViewerProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

    function handleEditorDidMount(editor: monaco.editor.IStandaloneCodeEditor, monaco: Monaco) {
        editorRef.current = editor;

        editorRef.current.revealLineInCenter(parseInt(editorParams.loc));
        editorRef.current.focus();
    }

    useEffect(() => {
        console.log('update editor');
        if (editorRef.current !== null) {
            editorRef.current.setValue(editorParams.value);
            editorRef.current.revealLineInCenter(parseInt(editorParams.loc));
            editorRef.current.setPosition({'lineNumber': parseInt(editorParams.loc), column: 1});
            editorRef.current.focus();
            editorRef.current.layout();
        }
    }, [editorParams]);

    return <Editor height="100%" onMount={handleEditorDidMount} value={editorParams.value} language={editorParams.language} path={editorParams.path} />;
}