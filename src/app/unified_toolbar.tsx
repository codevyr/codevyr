import React, { useMemo } from 'react';
import {
  LuCamera,
  LuChevronDown,
  LuFileText,
  LuFocus,
  LuGitMerge,
  LuHand,
  LuLayoutGrid,
  LuMaximize2,
  LuEllipsis,
  LuMousePointer2,
  LuPlay,
  LuRotateCcw,
  LuSearch,
  LuShare2,
} from 'react-icons/lu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ScreenshotMode } from './lib/use_screenshot';
import type { InteractionMode } from './lib/use_interaction_mode';
import type { GraphViewerHandle } from './graph_viewer';
import { useOverflowToolbar, type ToolbarGroupConfig } from './lib/use_overflow_toolbar';

export type ShareStatus = 'idle' | 'copied' | 'error';

const iconClassName = 'w-4 h-4';

const TOOLBAR_GROUPS: ToolbarGroupConfig[] = [
  { id: 'query', priority: 1 },
  { id: 'interaction', priority: 4 },
  { id: 'view', priority: 3 },
  { id: 'tools', priority: 2 },
];

export interface UnifiedToolbarProps {
  onRunQuery: () => void;
  onSaveToFile: () => void;
  onOpenFromFile: () => void;
  onShare: () => void;
  shareStatus: ShareStatus;
  graphViewerRef: React.RefObject<GraphViewerHandle | null>;
  mode: InteractionMode;
  onModeChange: (m: InteractionMode) => void;
  autoMerge: boolean;
  onAutoMergeChange: (enabled: boolean) => void;
  hasGraph: boolean;
}

interface ButtonDef {
  id: string;
  label: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

interface DropdownItemDef {
  label: string;
  onSelect: () => void;
  shortcut?: string;
}

type DropdownEntry = DropdownItemDef | 'separator';

interface DropdownDef {
  id: string;
  label: string;
  title: string;
  icon: React.ReactNode;
  disabled?: boolean;
  items: DropdownEntry[];
}

type ToolbarItem = ({ type: 'button' } & ButtonDef) | ({ type: 'dropdown' } & DropdownDef);

interface GroupDef {
  id: string;
  items: ToolbarItem[];
  graphOnly?: boolean;
}

function ToolbarButton({
  item,
  compact,
}: {
  item: ButtonDef;
  compact: boolean;
}) {
  return (
    <button
      onClick={item.onClick}
      className={`toolbar-btn${item.active ? ' toolbar-btn-active' : ''}`}
      title={item.title}
      disabled={item.disabled}
      aria-disabled={item.disabled}
      tabIndex={item.disabled ? -1 : undefined}
    >
      {item.icon}
      {!compact && <span className="toolbar-btn-label">{item.label}</span>}
    </button>
  );
}

function ToolbarDropdown({
  item,
  compact,
}: {
  item: DropdownDef;
  compact: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="toolbar-btn"
          title={item.title}
          disabled={item.disabled}
          aria-disabled={item.disabled}
          tabIndex={item.disabled ? -1 : undefined}
        >
          {item.icon}
          {!compact && <span className="toolbar-btn-label">{item.label}</span>}
          <LuChevronDown className={iconClassName} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="context-menu-content" sideOffset={4} align="start">
          {item.items.map((mi, idx) =>
            mi === 'separator' ? (
              <DropdownMenu.Separator key={`sep-${idx}`} className="dropdown-menu-separator" />
            ) : (
              <DropdownMenu.Item
                key={mi.label}
                className="dropdown-menu-item"
                onSelect={mi.onSelect}
              >
                {mi.label}
                {mi.shortcut && <span className="ml-auto text-xs text-gray-400 pl-4">{mi.shortcut}</span>}
              </DropdownMenu.Item>
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function renderToolbarItem(item: ToolbarItem, compact: boolean) {
  if (item.type === 'button') {
    return <ToolbarButton key={item.id} item={item} compact={compact} />;
  }
  return <ToolbarDropdown key={item.id} item={item} compact={compact} />;
}

export function UnifiedToolbar({
  onRunQuery,
  onSaveToFile,
  onOpenFromFile,
  onShare,
  shareStatus,
  graphViewerRef,
  mode,
  onModeChange,
  autoMerge,
  onAutoMergeChange,
  hasGraph,
}: UnifiedToolbarProps) {
  const modKey =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

  const statusText =
    shareStatus === 'copied' ? 'Copied' : shareStatus === 'error' ? 'Copy failed' : null;

  const shareLinkLabel =
    shareStatus === 'copied' ? 'Copied' : shareStatus === 'error' ? 'Copy failed' : 'Share Link';

  const groups: GroupDef[] = useMemo(() => [
    {
      id: 'query',
      items: [
        {
          type: 'button',
          id: 'run',
          label: 'Run',
          title: 'Run query (Ctrl+Enter)',
          icon: <LuPlay className={iconClassName} />,
          onClick: onRunQuery,
        },
        {
          type: 'dropdown',
          id: 'query-menu',
          label: 'Query',
          title: 'Query actions',
          icon: <LuFileText className={iconClassName} />,
          items: [
            { label: 'Save to File...', onSelect: onSaveToFile, shortcut: `${modKey}S` },
            { label: 'Open from File...', onSelect: onOpenFromFile, shortcut: `${modKey}O` },
            'separator',
            { label: shareLinkLabel, onSelect: onShare },
          ],
        },
      ],
    },
    {
      id: 'interaction',
      graphOnly: true,
      items: [
        {
          type: 'button',
          id: 'hand',
          label: 'Hand',
          title: 'Hand tool (H) \u2014 drag to pan',
          icon: <LuHand className={iconClassName} />,
          onClick: () => onModeChange('hand'),
          active: mode === 'hand',
        },
        {
          type: 'button',
          id: 'select',
          label: 'Select',
          title: 'Select tool (V) \u2014 drag to select',
          icon: <LuMousePointer2 className={iconClassName} />,
          onClick: () => onModeChange('select'),
          active: mode === 'select',
        },
        {
          type: 'button',
          id: 'merge',
          label: 'Merge',
          title: 'Auto-merge same-name symbols',
          icon: <LuGitMerge className={iconClassName} />,
          onClick: () => onAutoMergeChange(!autoMerge),
          active: autoMerge,
        },
      ],
    },
    {
      id: 'view',
      graphOnly: true,
      items: [
        {
          type: 'button',
          id: 'redraw',
          label: 'Redraw',
          title: 'Redraw layout',
          icon: <LuLayoutGrid className={iconClassName} />,
          onClick: () => graphViewerRef.current?.redrawLayout(),
        },
        {
          type: 'button',
          id: 'center',
          label: 'Center',
          title: 'Center Graph',
          icon: <LuFocus className={iconClassName} />,
          onClick: () => graphViewerRef.current?.centerGraph(),
        },
        {
          type: 'button',
          id: 'fit-view',
          label: 'Fit View',
          title: 'Fit to View',
          icon: <LuMaximize2 className={iconClassName} />,
          onClick: () => graphViewerRef.current?.fitToView(),
        },
        {
          type: 'button',
          id: 'reset-zoom',
          label: 'Reset Zoom',
          title: 'Reset Zoom',
          icon: <LuRotateCcw className={iconClassName} />,
          onClick: () => graphViewerRef.current?.resetZoom(),
        },
      ],
    },
    {
      id: 'tools',
      graphOnly: true,
      items: [
        {
          type: 'button',
          id: 'search',
          label: 'Search',
          title: 'Search nodes (Ctrl+F)',
          icon: <LuSearch className={iconClassName} />,
          onClick: () => graphViewerRef.current?.openSearch(),
        },
        {
          type: 'dropdown',
          id: 'screenshot',
          label: 'Screenshot',
          title: 'Take screenshot',
          icon: <LuCamera className={iconClassName} />,
          items: [
            { label: 'All Nodes', onSelect: () => graphViewerRef.current?.takeScreenshot('all-nodes') },
            { label: 'Visible Area', onSelect: () => graphViewerRef.current?.takeScreenshot('visible-area') },
          ],
        },
      ],
    },
  ], [onRunQuery, onSaveToFile, onOpenFromFile, onShare, shareLinkLabel, modKey, graphViewerRef, mode, onModeChange, autoMerge, onAutoMergeChange]);

  const { mode: displayMode, overflowIds, measureRef, containerRef } = useOverflowToolbar(TOOLBAR_GROUPS);

  const compact = displayMode === 'compact';

  // Collect items that overflow into the "..." menu
  const overflowItems = useMemo(() => {
    const items: { group: GroupDef; item: ToolbarItem }[] = [];
    for (const g of groups) {
      if (overflowIds.has(g.id)) {
        for (const item of g.items) {
          items.push({ group: g, item });
        }
      }
    }
    return items;
  }, [groups, overflowIds]);

  return (
    <div className="toolbar-container" ref={containerRef}>
      {/* Hidden measurement container */}
      <div className="toolbar-measure" ref={measureRef} aria-hidden="true">
        {groups.map((g) => (
          <React.Fragment key={g.id}>
            <div data-group-id={g.id} data-variant="full" className="toolbar-button-group" style={{ display: 'inline-flex' }}>
              {g.items.map((item) => (
                <span key={item.id} className="toolbar-btn-measure">
                  {item.icon}
                  <span>{item.label}</span>
                  {item.type === 'dropdown' && <LuChevronDown className={iconClassName} />}
                </span>
              ))}
            </div>
            <div data-group-id={g.id} data-variant="compact" className="toolbar-button-group" style={{ display: 'inline-flex' }}>
              {g.items.map((item) => (
                <span key={item.id} className="toolbar-btn-measure">
                  {item.icon}
                  {item.type === 'dropdown' && <LuChevronDown className={iconClassName} />}
                </span>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Visible toolbar */}
      {groups.map((g, gi) => {
        if (overflowIds.has(g.id)) return null;
        const graphDisabled = g.graphOnly && !hasGraph;
        return (
          <React.Fragment key={g.id}>
            {gi > 0 && !overflowIds.has(groups[gi - 1]?.id) && (
              <div className="toolbar-separator" />
            )}
            <div className={`toolbar-button-group${graphDisabled ? ' toolbar-group-disabled' : ''}`}>
              {g.items.map((item) => {
                const disabledItem = graphDisabled
                  ? { ...item, disabled: true }
                  : item;
                return renderToolbarItem(disabledItem, compact);
              })}
            </div>
          </React.Fragment>
        );
      })}

      {/* Share status feedback (inline, only when active) */}
      {statusText && !compact && (
        <span className="text-xs text-gray-500 ml-1">{statusText}</span>
      )}

      <div className="flex-1" />

      {/* Overflow menu */}
      {overflowItems.length > 0 && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="toolbar-btn" title="More actions">
              <LuEllipsis className={iconClassName} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="context-menu-content" sideOffset={4} align="end">
              {(() => {
                const elements: React.ReactNode[] = [];
                let lastGroupId: string | null = null;
                for (const { group, item } of overflowItems) {
                  if (lastGroupId && lastGroupId !== group.id) {
                    elements.push(
                      <DropdownMenu.Separator key={`sep-${group.id}`} className="dropdown-menu-separator" />
                    );
                  }
                  lastGroupId = group.id;
                  const graphDisabled = group.graphOnly && !hasGraph;

                  if (item.type === 'button') {
                    elements.push(
                      <DropdownMenu.Item
                        key={item.id}
                        className={`dropdown-menu-item${item.active ? ' dropdown-menu-item-active' : ''}`}
                        onSelect={item.onClick}
                        disabled={graphDisabled}
                      >
                        {item.icon}
                        {item.label}
                        {item.active && <span className="ml-auto text-blue-500">&#10003;</span>}
                      </DropdownMenu.Item>
                    );
                  } else {
                    // Render dropdown items as flat menu items in overflow
                    for (let mi_idx = 0; mi_idx < item.items.length; mi_idx++) {
                      const mi = item.items[mi_idx];
                      if (mi === 'separator') {
                        elements.push(
                          <DropdownMenu.Separator key={`${item.id}-sep-${mi_idx}`} className="dropdown-menu-separator" />
                        );
                        continue;
                      }
                      elements.push(
                        <DropdownMenu.Item
                          key={`${item.id}-${mi.label}`}
                          className="dropdown-menu-item"
                          onSelect={mi.onSelect}
                          disabled={graphDisabled}
                        >
                          {mi.label}
                        </DropdownMenu.Item>
                      );
                    }
                  }
                }
                return elements;
              })()}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}
