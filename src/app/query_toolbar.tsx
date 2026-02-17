import React from 'react';
import { LuPlay, LuShare2 } from 'react-icons/lu';

interface ToolbarButtonProps {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, title, icon, children }: ToolbarButtonProps) {
  return (
    <button onClick={onClick} className="toolbar-btn" title={title}>
      {icon}
      {children}
    </button>
  );
}

const iconClassName = 'w-4 h-4';

export type ShareStatus = 'idle' | 'copied' | 'error';

export interface QueryToolbarProps {
  onRunQuery: () => void;
  onShare: () => void;
  status?: ShareStatus;
}

export function QueryToolbar({
  onRunQuery,
  onShare,
  status = 'idle',
}: QueryToolbarProps) {
  const statusText =
    status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : null;

  return (
    <div className="toolbar-container">
      <div className="toolbar-button-group">
        <ToolbarButton
          onClick={onRunQuery}
          title="Run query (Ctrl+Enter)"
          icon={<LuPlay className={iconClassName} />}
        >
          Run
        </ToolbarButton>
        <ToolbarButton
          onClick={onShare}
          title="Copy shareable link"
          icon={<LuShare2 className={iconClassName} />}
        >
          Share
        </ToolbarButton>
        {statusText ? (
          <span className="text-xs text-gray-500">{statusText}</span>
        ) : null}
      </div>

      <div className="flex-1"></div>

      <div className="toolbar-label">
        <span>Query Controls</span>
      </div>
    </div>
  );
}
