import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Editor, Monaco } from "@monaco-editor/react";
import type * as monaco from 'monaco-editor';
import * as monacoEditor from 'monaco-editor';
import { getLineColumnFromOffset, parseOffset, type OffsetValue } from './lib/offsets';
import { registerMakefile } from './monaco-makefile-language';

export interface CodeFocus {
    object_id: string;
    start_offset: OffsetValue;
    end_offset?: OffsetValue | null;
}

export interface EditorParams {
    fileId?: string;
    path: string;
    language: string;
    value: string;
    focusStartOffset: OffsetValue;
    focusEndOffset?: OffsetValue | null;
    isVisible: () => boolean;
}

export interface CodeViewerProps {
    editorParams: EditorParams;
}

const RETRY_DELAY_MS = 16;

type FocusLocation = {
    lineNumber: number;
    column: number;
};

export function CodeViewer({ editorParams }: CodeViewerProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const layoutListenerRef = useRef<monaco.IDisposable | null>(null);
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingOffsetRef = useRef<number | null>(null);
    const centerRequestedLocationRef = useRef<() => void>(() => {});

    const clearRetryTimeout = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
    }, []);

    const resolveFocusOffset = useCallback(() => {
        const parsedOffset = parseOffset(editorParams.focusStartOffset);
        return parsedOffset === null ? 0 : parsedOffset;
    }, [editorParams.focusStartOffset]);

    const resolveFocusLocation = useCallback((): FocusLocation => {
        const offset = resolveFocusOffset();
        const location = getLineColumnFromOffset(editorParams.value, offset);
        return location ?? { lineNumber: 1, column: 1 };
    }, [editorParams.value, resolveFocusOffset]);

    const scheduleCenterRetry = useCallback(() => {
        clearRetryTimeout();
        retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            centerRequestedLocationRef.current();
        }, RETRY_DELAY_MS);
    }, [clearRetryTimeout]);

    const centerRequestedLocation = useCallback(() => {
        const editor = editorRef.current;
        const targetOffset = pendingOffsetRef.current;
        const resolvedOffset = resolveFocusOffset();

        if (!editor || targetOffset === null || targetOffset !== resolvedOffset) {
            clearRetryTimeout();
            return;
        }

        const layoutInfo = editor.getLayoutInfo();
        if (!layoutInfo || layoutInfo.height < 10) {
            scheduleCenterRetry();
            return;
        }

        const model = editor.getModel();
        if (!model) {
            return;
        }

        pendingOffsetRef.current = null;
        const { lineNumber, column } = resolveFocusLocation();
        const clampedLine = Math.max(1, Math.min(lineNumber, model.getLineCount()));

        if (layoutListenerRef.current) {
            layoutListenerRef.current.dispose();
            layoutListenerRef.current = null;
        }

        editor.setPosition({ lineNumber: clampedLine, column });
        editor.revealPositionInCenter({ lineNumber: clampedLine, column });
        editor.focus();

    }, [clearRetryTimeout, resolveFocusLocation, resolveFocusOffset, scheduleCenterRetry]);

    useEffect(() => {
        centerRequestedLocationRef.current = centerRequestedLocation;
    }, [centerRequestedLocation]);

    useEffect(() => {
        const editor = editorRef.current;
        const requestedOffset = resolveFocusOffset();

        pendingOffsetRef.current = requestedOffset;
        const isVisible = editorParams.isVisible();
        if (isVisible) {
            centerRequestedLocation();
        } else {
            scheduleCenterRetry();
        }
    }, [editorParams, centerRequestedLocation, resolveFocusOffset, scheduleCenterRetry]);

    const handleEditorDidMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
        editorRef.current = editor;
        registerMakefile(monacoInstance);

        if (layoutListenerRef.current) {
            layoutListenerRef.current.dispose();
            layoutListenerRef.current = null;
        }
        layoutListenerRef.current = editor.onDidLayoutChange(() => {
            centerRequestedLocation();
        });

        centerRequestedLocation();
    }, [centerRequestedLocation]);

    useEffect(() => {
        return () => {
            clearRetryTimeout();
            editorRef.current = null;
            pendingOffsetRef.current = null;
        };
    }, [clearRetryTimeout]);

    return (
        <div className="h-full w-full" data-testid="code-viewer" data-file-id={editorParams.fileId ?? ''}>
            <Editor height="100%" onMount={handleEditorDidMount} value={editorParams.value} language={editorParams.language} path={editorParams.path} options={{ readOnly: true }} />
        </div>
    );
}
