import { useEffect, useRef, useState } from "react";
import { fetchSource } from "./askld";
import { Editor, Monaco } from "@monaco-editor/react";
import monaco from 'monaco-editor';

export interface CodeFocus {
    uri: string;
    loc: string;
}

export interface CodeViewerProps {
    codeFocus: CodeFocus | null;
}

export function CodeViewer({ codeFocus }: CodeViewerProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const [currentFile, setCurrentFile] = useState({ 'path': '', 'language': '', 'value': '', 'loc': '0' });

    function handleEditorDidMount(editor: monaco.editor.IStandaloneCodeEditor, monaco: Monaco) {
        editorRef.current = editor;

        console.log('editor mounted');
        if (codeFocus === null) {
            return;
        }
        editorRef.current.revealLineInCenter(parseInt(codeFocus.loc));
        editorRef.current.focus();
    }

    useEffect(() => {
        if (codeFocus === null) {
            return;
        }

        fetchSource(codeFocus.uri).then(response => response.text()).then(data => {
            setCurrentFile({
                'path': codeFocus.uri,
                'language': 'c',
                'value': data,
                'loc': codeFocus.loc
            })
        })
    }, [codeFocus]);

    useEffect(() => {
        if (editorRef.current !== null) {
            editorRef.current.setValue(currentFile.value);
            editorRef.current.revealLineInCenter(parseInt(currentFile.loc));
            editorRef.current.setPosition({'lineNumber': parseInt(currentFile.loc), column: 1});
            editorRef.current.focus();
            editorRef.current.layout();
        }
    }, [currentFile]);

    return <Editor height="100%" onMount={handleEditorDidMount} value={currentFile.value} language={currentFile.language} path={currentFile.path} />;
}