import { useEffect, useRef } from "react";
import { Editor, Monaco } from "@monaco-editor/react";
import monaco from 'monaco-editor';

export interface CodeFocus {
    file_id: string;
    line: string;
}

export interface EditorParams {
    path: string;
    language: string;
    value: string;
    loc: string;
}

export interface CodeViewerProps {
    editorParams: EditorParams;
}

export function CodeViewer({ editorParams }: CodeViewerProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

    function handleEditorDidMount(editor: monaco.editor.IStandaloneCodeEditor, _monaco: Monaco) {
        editorRef.current = editor;
        const lineNumber = parseInt(editorParams.loc, 10);

        if (!Number.isNaN(lineNumber)) {
            editorRef.current.revealLineInCenter(lineNumber);
            editorRef.current.setPosition({ lineNumber, column: 1 });
        }
        editorRef.current.focus();
    }

    useEffect(() => {
        if (editorRef.current !== null) {
            const lineNumber = parseInt(editorParams.loc, 10);
            editorRef.current.setValue(editorParams.value);
            if (!Number.isNaN(lineNumber)) {
                editorRef.current.revealLineInCenter(lineNumber);
                editorRef.current.setPosition({ lineNumber, column: 1 });
            }
            editorRef.current.focus();
            editorRef.current.layout();
        }
    }, [editorParams.language, editorParams.loc, editorParams.path, editorParams.value]);

    return <Editor height="100%" onMount={handleEditorDidMount} value={editorParams.value} language={editorParams.language} path={editorParams.path} />;
}
