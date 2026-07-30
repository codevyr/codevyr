'use client';

import { useEffect, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { fetchQueryMarkdown, Projection } from './askld';

/**
 * Renders the report text in a read-only Monaco editor. The report is
 * whitespace-aligned, line-oriented text (indented `→` children, fenced code),
 * so it must be shown monospace with whitespace preserved — an HTML markdown
 * renderer would collapse the alignment. This also matches exactly what an AI
 * agent receives from the MCP.
 */
export function MarkdownView({ content }: { content: string }) {
  // Absolutely fill the (relative) parent so Monaco measures a concrete pixel
  // box. A percentage/flex height chain collapses to zero when the Find widget
  // (Ctrl+F) forces a re-layout, making the text vanish. `domReadOnly` is
  // deliberately not set — it interferes with the Find widget.
  return (
    <div className="absolute inset-0">
      <Editor
        height="100%"
        language="markdown"
        value={content}
        options={{
          readOnly: true,
          automaticLayout: true,
          minimap: { enabled: false },
          wordWrap: 'off',
          lineNumbers: 'off',
          scrollBeyondLastLine: false,
          folding: false,
          renderWhitespace: 'none',
          fontSize: 12,
        }}
      />
    </div>
  );
}

export interface MarkdownReportProps {
  /** The last successfully-run query (may be empty before the first run). */
  query: string;
}

/** A completed fetch, tagged with the query/projection it was fetched for. */
interface Report {
  query: string;
  projection: Projection;
  content: string;
  error: string;
}

/**
 * Shows the backend-rendered markdown report for the current query — the exact
 * output an AI agent gets from the MCP. Fetches lazily when mounted and whenever
 * the query or projection changes.
 */
export function MarkdownReport({ query }: MarkdownReportProps) {
  const [projection, setProjection] = useState<Projection>('signature');
  const [report, setReport] = useState<Report | null>(null);

  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (!hasQuery) {
      return;
    }

    let cancelled = false;
    fetchQueryMarkdown(query, projection)
      .then(async (res) => {
        const text = await res.text();
        if (cancelled) return;
        setReport({
          query,
          projection,
          content: res.ok ? text : '',
          error: res.ok ? '' : text || `Request failed (${res.status})`,
        });
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setReport({ query, projection, content: '', error: String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [query, projection, hasQuery]);

  // Derive loading from whether the stored report matches the current inputs,
  // rather than tracking a 'loading' status with a synchronous setState in the
  // effect (which triggers cascading renders).
  const current = report && report.query === query && report.projection === projection ? report : null;
  const loading = hasQuery && !current;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 p-2 text-sm">
        <label htmlFor="report-projection" className="text-muted">Detail</label>
        <select
          id="report-projection"
          className="rounded border border-gray-300 px-1 py-0.5 text-sm"
          value={projection}
          onChange={(e) => setProjection(e.target.value as Projection)}
        >
          <option value="names">names</option>
          <option value="signature">signature</option>
          <option value="body">body</option>
        </select>
      </div>
      <div className="relative min-h-0 flex-1">
        {!hasQuery && (
          <div className="p-6 text-sm text-muted">Run a query to see its report.</div>
        )}
        {loading && (
          <div className="p-4 text-sm text-muted">Rendering report…</div>
        )}
        {current && current.error && (
          <pre className="whitespace-pre-wrap p-4 text-sm text-red-600">{current.error}</pre>
        )}
        {current && !current.error && <MarkdownView content={current.content} />}
      </div>
    </div>
  );
}
