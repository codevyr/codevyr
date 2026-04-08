import React from 'react';
import {
  LuFocus,
  LuHand,
  LuLayoutGrid,
  LuMaximize2,
  LuMousePointer2,
  LuRotateCcw,
} from 'react-icons/lu';

// Reusable toolbar button component
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

const iconClassName = "w-4 h-4";

export type InteractionMode = 'hand' | 'select';

export interface GraphToolbarProps {
  onDagreLayout: () => void;
  onCenterGraph: () => void;
  onFitToView: () => void;
  onResetZoom: () => void;
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
}

export function GraphToolbar({
  onDagreLayout,
  onCenterGraph,
  onFitToView,
  onResetZoom,
  mode,
  onModeChange,
}: GraphToolbarProps) {
  return (
    <div className="toolbar-container">
      <div className="toolbar-button-group">
        <button
          onClick={() => onModeChange('hand')}
          className={`toolbar-btn${mode === 'hand' ? ' toolbar-btn-active' : ''}`}
          title="Hand tool (H) — drag to pan"
        >
          <LuHand className={iconClassName} />
          Hand
        </button>
        <button
          onClick={() => onModeChange('select')}
          className={`toolbar-btn${mode === 'select' ? ' toolbar-btn-active' : ''}`}
          title="Select tool (V) — drag to select"
        >
          <LuMousePointer2 className={iconClassName} />
          Select
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-button-group">
        <ToolbarButton
          onClick={onDagreLayout}
          title="Redraw"
          icon={<LuLayoutGrid className={iconClassName} />}
        >
          Redraw
        </ToolbarButton>

        <ToolbarButton
          onClick={onCenterGraph}
          title="Center Graph"
          icon={<LuFocus className={iconClassName} />}
        >
          Center
        </ToolbarButton>

        <ToolbarButton
          onClick={onFitToView}
          title="Fit to View"
          icon={<LuMaximize2 className={iconClassName} />}
        >
          Fit View
        </ToolbarButton>

        <ToolbarButton
          onClick={onResetZoom}
          title="Reset Zoom"
          icon={<LuRotateCcw className={iconClassName} />}
        >
          Reset Zoom
        </ToolbarButton>
      </div>

      <div className="flex-1"></div>

      <div className="toolbar-label">
        <span>Graph Controls</span>
      </div>
    </div>
  );
}
