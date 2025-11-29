import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Editor, Monaco } from "@monaco-editor/react";
import type * as monaco from 'monaco-editor';
import * as monacoEditor from 'monaco-editor';

export interface CodeFocus {
    file_id: string;
    line: string;
}

export interface EditorParams {
    path: string;
    language: string;
    value: string;
    loc: string;
    isVisible: () => boolean;
}

export interface CodeViewerProps {
    editorParams: EditorParams;
}

const RETRY_DELAY_MS = 16;

function locIntoLineNumber(loc: string): number {
    const parsed = parseInt(loc, 10);
    return Number.isNaN(parsed) ? 1 : parsed;
}

export function CodeViewer({ editorParams }: CodeViewerProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const layoutListenerRef = useRef<monaco.IDisposable | null>(null);
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingLineRef = useRef<number | null>(null);

    const clearRetryTimeout = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
    }, []);

    const centerRequestedLine = useCallback(() => {
        const editor = editorRef.current;
        const targetLine = pendingLineRef.current;

        if (!editor || targetLine === null || targetLine !== locIntoLineNumber(editorParams.loc)) {
            clearRetryTimeout();
            return;
        }

        const layoutInfo = editor.getLayoutInfo();
        if (!layoutInfo || layoutInfo.height < 10) {
            clearRetryTimeout();
            retryTimeoutRef.current = setTimeout(() => {
                retryTimeoutRef.current = null;
                centerRequestedLine();
            }, RETRY_DELAY_MS);
            return;
        }

        const model = editor.getModel();
        if (!model) {
            return;
        }

        pendingLineRef.current = null;
        const clampedLine = Math.max(1, Math.min(targetLine, model.getLineCount()));

        if (layoutListenerRef.current) {
            layoutListenerRef.current.dispose();
            layoutListenerRef.current = null;
        }

        editor.setPosition({ lineNumber: clampedLine, column: 1 });
        editor.revealLineInCenter(clampedLine);
        editor.focus();

    }, [clearRetryTimeout, editorParams.loc]);

    useEffect(() => {
        const editor = editorRef.current;
        const requestedLine = locIntoLineNumber(editorParams.loc);

        pendingLineRef.current = requestedLine;
        const isVisible = editorParams.isVisible();
        if (isVisible) {
            centerRequestedLine();
        } else {
            clearRetryTimeout();
            retryTimeoutRef.current = setTimeout(() => {
                retryTimeoutRef.current = null;
                centerRequestedLine();
            }, RETRY_DELAY_MS);
        }
    }, [editorParams, centerRequestedLine, clearRetryTimeout]);

    const handleEditorDidMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
        editorRef.current = editor;

        if (layoutListenerRef.current) {
            layoutListenerRef.current.dispose();
            layoutListenerRef.current = null;
        }
        layoutListenerRef.current = editor.onDidLayoutChange(() => {
            centerRequestedLine();
        });

      
    }, [centerRequestedLine]);

    useEffect(() => {
        return () => {
            clearRetryTimeout();
            editorRef.current = null;
            pendingLineRef.current = null;
        };
    }, [clearRetryTimeout]);

    return <Editor height="100%" onMount={handleEditorDidMount} value={editorParams.value} language={editorParams.language} path={editorParams.path} />;
}
