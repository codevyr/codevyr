'use client';

import React from 'react';

export type ProblemSeverity = 'error' | 'warning' | 'info';

export interface ProblemRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface Problem {
  id: string;
  message: string;
  severity: ProblemSeverity;
  range?: ProblemRange | null;
  source?: string | null;
  lineText?: string | null;
}

interface ProblemsProps {
  problems: Problem[];
  onSelectProblem?: (problem: Problem) => void;
}

const severityCopy: Record<ProblemSeverity, { label: string; tone: string }> = {
  error: { label: 'Error', tone: 'text-red-600' },
  warning: { label: 'Warning', tone: 'text-yellow-600' },
  info: { label: 'Info', tone: 'text-blue-600' },
};

function formatLocation(problem: Problem) {
  if (!problem.range) {
    return '—';
  }

  const { startLineNumber, startColumn } = problem.range;
  return `Ln ${startLineNumber}, Col ${startColumn}`;
}

export function Problems({ problems, onSelectProblem }: ProblemsProps) {
  if (problems.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No problems found.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Message</th>
            <th className="px-4 py-2">Location</th>
          </tr>
        </thead>
        <tbody>
          {problems.map(problem => {
            const severity = severityCopy[problem.severity];
            return (
              <tr
                key={problem.id}
                className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                onClick={() => onSelectProblem?.(problem)}
              >
                <td className={`px-4 py-2 font-medium ${severity.tone}`}>
                  <span className="mr-2 text-base">●</span>
                  {severity.label}
                </td>
                <td className="px-4 py-2 text-gray-800">
                  <div className="font-medium whitespace-pre-wrap font-mono">{problem.message}</div>
                  {problem.source && (
                    <div className="text-xs text-gray-500">{problem.source}</div>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-600">{formatLocation(problem)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
