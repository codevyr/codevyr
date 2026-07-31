/**
 * A query warning as returned by the backend (`ErrorResponse`), with the
 * structured no-match fields M3 added. Only the fields this helper reads are
 * declared; the full diagnostic carries location/line_col too.
 */
export interface WarningDiagnostic {
  message?: string;
  /** Nearest existing symbol names for a no-match typo. */
  suggestions?: string[];
  /** True when the name exists but was excluded by a filter/scope. */
  name_exists?: boolean;
}

/**
 * The message shown for a warning, augmented with the same self-correction
 * hints the markdown report renders — "Did you mean" for a typo, or the
 * "name exists but wasn't matched here" note. Backticks are omitted because the
 * Problems tab is plain monospace text, not markdown. Pure, for testing.
 */
export function warningMessage(warning: WarningDiagnostic): string {
  const base = warning.message ?? 'Warning';
  if (warning.suggestions && warning.suggestions.length > 0) {
    return `${base}. Did you mean: ${warning.suggestions.join(', ')}?`;
  }
  if (warning.name_exists) {
    return `${base}. The name exists but wasn't matched here — check the type, project, or relationship (caller/callee) filters.`;
  }
  return base;
}
