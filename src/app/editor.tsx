'use client';

import React, { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Editor, Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditor, IRange } from 'monaco-editor';
import { Node, Edge, Graph } from './graph';
import { setupEditorTestApis } from './testing/editor_test_utils';

import { fetchQuery } from './askld';
import { registerAskl } from './monaco-askl-language';
import { Problem } from './problems';
import { getLineColumnFromOffset } from './lib/offsets';

export interface EditorHandle {
    revealRange: (range: IRange) => void;
    getQuery: () => string;
    setQuery: (nextQuery: string) => void;
}

interface EditorProps {
    query: string;
    onGraphChange: (graph: Graph) => void;
    onProblemsChange?: (problems: Problem[]) => void;
}

interface RustGraph {
    nodes: Map<string, Node>;
    edges: Set<Edge>;
    files: Array<[string, string]>;
    warnings?: QueryDiagnostic[];
}

interface QueryDiagnostic {
    message: string;
    location?: InputLocation;
    line_col?: LineColLocation;
    path?: string | null;
    line?: string;
}

type PositionTuple = [number, number];

type InputLocation =
    | { Pos: number }
    | { Span: [number, number] };

type LineColLocation =
    | { Pos: PositionTuple }
    | { Span: [PositionTuple, PositionTuple] };

const QUERY_ERROR_MARKER_OWNER = 'askl-query-error';

const defaultMarkerRange: IRange = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
};

function normalizePositionTuple(value: unknown): { lineNumber: number; column: number } | null {
    if (!Array.isArray(value) || value.length < 2) {
        return null;
    }

    const [line, column] = value;
    if (typeof line !== 'number' || typeof column !== 'number') {
        return null;
    }

    return {
        lineNumber: Math.max(1, line),
        column: Math.max(1, column),
    };
}

function getRangeFromLineCol(lineCol?: LineColLocation | null): IRange | null {
    if (!lineCol || typeof lineCol !== 'object') {
        return null;
    }

    if ('Pos' in lineCol) {
        const pos = normalizePositionTuple(lineCol.Pos);
        if (!pos) {
            return null;
        }

        return {
            startLineNumber: pos.lineNumber,
            startColumn: pos.column,
            endLineNumber: pos.lineNumber,
            endColumn: pos.column + 1,
        };
    }

    if ('Span' in lineCol) {
        const span = lineCol.Span;
        if (!Array.isArray(span) || span[0] == null) {
            return null;
        }

        const startPos = normalizePositionTuple(span[0]);
        const endPos = normalizePositionTuple(span[1] ?? span[0]);
        if (!startPos || !endPos) {
            return null;
        }

        return {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: Math.max(startPos.lineNumber === endPos.lineNumber ? startPos.column + 1 : 1, endPos.column),
        };
    }

    return null;
}

function getRangeFromOffsetLocation(source: string, location?: InputLocation | null): IRange | null {
    if (!location || typeof location !== 'object') {
        return null;
    }

    if ('Pos' in location) {
        const pos = getLineColumnFromOffset(source, location.Pos);
        if (!pos) {
            return null;
        }

        return {
            startLineNumber: pos.lineNumber,
            startColumn: pos.column,
            endLineNumber: pos.lineNumber,
            endColumn: pos.column + 1,
        };
    }

    if ('Span' in location) {
        const span = location.Span;
        if (!Array.isArray(span) || span[0] == null) {
            return null;
        }

        const startPos = getLineColumnFromOffset(source, span[0]);
        const endPos = getLineColumnFromOffset(source, span[1] ?? span[0]);
        if (!startPos || !endPos) {
            return null;
        }

        return {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: Math.max(startPos.lineNumber === endPos.lineNumber ? startPos.column + 1 : 1, endPos.column),
        };
    }

    return null;
}

function getRangeFromLocation(source: string, location?: InputLocation | null, lineCol?: LineColLocation | null): IRange | null {
    return getRangeFromOffsetLocation(source, location) ?? getRangeFromLineCol(lineCol);
}

function applyEditorErrorMarker(monacoInstance: Monaco | null, editor: MonacoEditor.ICodeEditor, message: string, range?: IRange | null) {
    if (!monacoInstance) {
        return;
    }

    const model = editor.getModel();
    if (!model) {
        return;
    }

    const markerRange = range ?? defaultMarkerRange;
    monacoInstance.editor.setModelMarkers(model, QUERY_ERROR_MARKER_OWNER, [
        {
            ...markerRange,
            severity: monacoInstance.MarkerSeverity.Error,
            message,
        },
    ]);

    editor.revealPositionInCenter({ lineNumber: markerRange.startLineNumber, column: markerRange.startColumn });
}

function clearEditorErrorMarker(monacoInstance: Monaco | null, editor: MonacoEditor.ICodeEditor) {
    if (!monacoInstance) {
        return;
    }

    const model = editor.getModel();
    if (!model) {
        return;
    }

    monacoInstance.editor.setModelMarkers(model, QUERY_ERROR_MARKER_OWNER, []);
}

let problemIdCounter = 0;

function nextProblemId() {
    problemIdCounter += 1;
    return `problem-${problemIdCounter}`;
}

function buildProblem(message: string, severity: Problem['severity'], range?: IRange | null, extras?: Partial<Problem>): Problem {
    return {
        id: extras?.id ?? nextProblemId(),
        message,
        severity,
        range,
        source: extras?.source ?? null,
        lineText: extras?.lineText ?? null,
    };
}

function buildProblemsFromWarnings(warnings: QueryDiagnostic[] | undefined, sourceText: string): Problem[] {
    if (!warnings || !Array.isArray(warnings)) {
        return [];
    }

    return warnings.map(warning => {
        const range = getRangeFromLocation(sourceText, warning.location, warning.line_col);
        return buildProblem(warning.message ?? 'Warning', 'warning', range, {
            source: warning.path ?? 'warning',
            lineText: warning.line ?? null,
        });
    });
}

async function handleQueryFailure(response: Response, monacoInstance: Monaco | null, editor: MonacoEditor.ICodeEditor, sourceText: string): Promise<Problem[]> {
    try {
        const errorData: QueryDiagnostic = await response.json();
        const range = getRangeFromLocation(sourceText, errorData.location, errorData.line_col);
        applyEditorErrorMarker(monacoInstance, editor, errorData.message || 'Query failed', range);
        return [
            buildProblem(errorData.message || 'Query failed', 'error', range, {
                source: errorData.path ?? 'parser',
                lineText: errorData.line ?? null,
            }),
        ];
    } catch (parseError) {
        console.error('Failed to parse query error response', parseError);
        applyEditorErrorMarker(monacoInstance, editor, `Query failed (${response.status})`);
        return [buildProblem(`Query failed (${response.status})`, 'error', defaultMarkerRange)];
    }
}

export const EditorComponent = React.forwardRef<EditorHandle, EditorProps>(function EditorComponent({ query, onGraphChange, onProblemsChange }: EditorProps, ref) {
    const testCleanupRef = useRef<(() => void) | null>(null);
    const monacoRef = useRef<Monaco | null>(null);
    const editorInstanceRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
    const queryRef = useRef(query);
    const queryGraph = async (ed: MonacoEditor.ICodeEditor) => {
        console.log('submit-query');
        try {
            const queryText = ed.getValue();
            const response = await fetchQuery(queryText);
            if (!response.ok) {
                const problems = await handleQueryFailure(response, monacoRef.current, ed, queryText);
                onProblemsChange?.(problems);
                return;
            }

            const data: RustGraph = await response.json();
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
            clearEditorErrorMarker(monacoRef.current, ed);
            const warningProblems = buildProblemsFromWarnings(data.warnings, queryText);
            onProblemsChange?.(warningProblems);
        } catch (error) {
            console.error('Failed to submit query', error);
            applyEditorErrorMarker(monacoRef.current, ed, 'Unable to submit query. Please try again.');
            onProblemsChange?.([buildProblem('Unable to submit query. Please try again.', 'error', defaultMarkerRange)]);
        }
    };

    const handleEditorWillMount = (monacoInstance: Monaco) => {
        monacoRef.current = monacoInstance;
        monacoInstance.editor.addEditorAction({
            id: 'submit-query',
            label: 'Submit Query',
            keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter],
            run: queryGraph
        });

        registerAskl(monacoInstance);
    };

    const handleEditorDidMount = useCallback((editorInstance: MonacoEditor.IStandaloneCodeEditor) => {
        editorInstanceRef.current = editorInstance;
        const cleanup = setupEditorTestApis(editorInstance);
        testCleanupRef.current = cleanup;
    }, []);

    useImperativeHandle(ref, () => ({
        revealRange(range: IRange) {
            if (!editorInstanceRef.current) {
                return;
            }

            editorInstanceRef.current.revealRangeInCenter(range);
            editorInstanceRef.current.setSelection(range);
            editorInstanceRef.current.focus();
        },
        getQuery() {
            return editorInstanceRef.current?.getValue() ?? queryRef.current;
        },
        setQuery(nextQuery: string) {
            queryRef.current = nextQuery;
            if (editorInstanceRef.current) {
                editorInstanceRef.current.setValue(nextQuery);
            }
        },
    }), []);

    useEffect(() => {
        queryRef.current = query;
        if (!editorInstanceRef.current) {
            return;
        }
        const currentValue = editorInstanceRef.current.getValue();
        if (currentValue !== query) {
            editorInstanceRef.current.setValue(query);
        }
    }, [query]);

    useEffect(() => {
        return () => {
            if (testCleanupRef.current) {
                testCleanupRef.current();
                testCleanupRef.current = null;
            }
            editorInstanceRef.current = null;
        };
    }, []);

    return <Editor height="100%" defaultLanguage="askl" defaultValue={query} beforeMount={handleEditorWillMount} onMount={handleEditorDidMount} />;
});
