import React, { useState } from 'react';
import { LuPlay, LuShare2, LuSave, LuChevronDown, LuTrash2, LuPencil, LuCheck, LuX } from 'react-icons/lu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useSavedQueries, SavedQuery } from './lib/use_saved_queries';

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
  onGetQuery: () => string;
  onLoadQuery: (query: string) => void;
  status?: ShareStatus;
}

function SavedQueryItem({
  sq,
  onLoad,
  onRename,
  onDelete,
}: {
  sq: SavedQuery;
  onLoad: (query: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sq.name);

  const submitRename = () => {
    const trimmed = draft.trim();
    if (trimmed) onRename(sq.id, trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="dropdown-menu-item">
        <input
          autoFocus
          className="flex-1 min-w-0 text-sm border border-gray-300 rounded px-1.5 py-0.5 outline-none focus:border-blue-400"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              submitRename();
            } else if (e.key === 'Escape') {
              setDraft(sq.name);
              setEditing(false);
            }
          }}
        />
        <button
          className="p-0.5 text-green-600 hover:text-green-800"
          title="Confirm"
          onClick={submitRename}
        >
          <LuCheck className={iconClassName} />
        </button>
        <button
          className="p-0.5 text-gray-400 hover:text-gray-600"
          title="Cancel"
          onClick={() => {
            setDraft(sq.name);
            setEditing(false);
          }}
        >
          <LuX className={iconClassName} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="dropdown-menu-item hover:bg-blue-50 hover:text-blue-900"
      role="menuitem"
      onClick={() => onLoad(sq.query)}
    >
      <span className="dropdown-menu-item-name">{sq.name}</span>
      <button
        className="ml-auto p-0.5 text-gray-400 hover:text-gray-700 shrink-0"
        title="Rename"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(sq.name);
          setEditing(true);
        }}
      >
        <LuPencil className="w-3.5 h-3.5" />
      </button>
      <button
        className="p-0.5 text-gray-400 hover:text-red-600 shrink-0"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(sq.id);
        }}
      >
        <LuX className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function QueryToolbar({
  onRunQuery,
  onShare,
  onGetQuery,
  onLoadQuery,
  status = 'idle',
}: QueryToolbarProps) {
  const { savedQueries, saveQuery, renameQuery, deleteQuery, clearAll } = useSavedQueries();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const statusText =
    status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : null;

  const handleSave = () => {
    const query = onGetQuery();
    if (query.trim()) {
      saveQuery(query);
    }
  };

  const handleLoad = (query: string) => {
    onLoadQuery(query);
    setDropdownOpen(false);
  };

  const handleClear = () => {
    clearAll();
    setDropdownOpen(false);
  };

  const count = savedQueries.length;

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

        <div className="save-split-button">
          <button
            onClick={handleSave}
            className="toolbar-btn save-split-main"
            title="Save current query"
          >
            <LuSave className={iconClassName} />
            Save{count > 0 ? ` (${count})` : ''}
          </button>
          <DropdownMenu.Root open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenu.Trigger asChild>
              <button className="toolbar-btn save-split-chevron" title="Saved queries">
                <LuChevronDown className={iconClassName} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="context-menu-content"
                sideOffset={4}
                align="start"
                onCloseAutoFocus={(e) => e.preventDefault()}
                onFocusOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => {
                  // Let Radix handle clicks outside the dropdown normally,
                  // but prevent closing when focus moves to an input inside.
                  if (e.target instanceof HTMLElement && e.target.closest('.context-menu-content')) {
                    e.preventDefault();
                  }
                }}
              >
                {savedQueries.length === 0 ? (
                  <div className="dropdown-menu-empty">No saved queries</div>
                ) : (
                  <>
                    {savedQueries.map(sq => (
                      <SavedQueryItem
                        key={sq.id}
                        sq={sq}
                        onLoad={handleLoad}
                        onRename={renameQuery}
                        onDelete={deleteQuery}
                      />
                    ))}
                    <DropdownMenu.Separator className="dropdown-menu-separator" />
                    <DropdownMenu.Item
                      className="dropdown-menu-item dropdown-menu-item-danger"
                      onSelect={handleClear}
                    >
                      <LuTrash2 className={iconClassName} />
                      Clear saved queries
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

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
