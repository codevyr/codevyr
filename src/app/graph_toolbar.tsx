import React from 'react';

// Reusable toolbar button component
interface ToolbarButtonProps {
    onClick: () => void;
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}

function ToolbarButton({ onClick, title, icon, children }: ToolbarButtonProps) {
    return (
        <button
            onClick={onClick}
            className="toolbar-btn"
            title={title}
        >
            {icon}
            {children}
        </button>
    );
}

// Icon components for better organization
const LayoutIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
);

const CenterIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m0-18l4 4m-4-4L8 7" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h18m-18 0l4-4m-4 4l4 4" />
    </svg>
);

const FitViewIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
);

const ResetZoomIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
    </svg>
);

export interface GraphToolbarProps {
    onRerunLayout: () => void;
    onCenterGraph: () => void;
    onFitToView: () => void;
    onResetZoom: () => void;
}

export function GraphToolbar({
    onRerunLayout,
    onCenterGraph,
    onFitToView,
    onResetZoom
}: GraphToolbarProps) {
    return (
        <div className="toolbar-container">
            <div className="toolbar-button-group">
                <ToolbarButton
                    onClick={onRerunLayout}
                    title="Rerun Layout"
                    icon={<LayoutIcon />}
                >
                    Layout
                </ToolbarButton>

                <ToolbarButton
                    onClick={onCenterGraph}
                    title="Center Graph"
                    icon={<CenterIcon />}
                >
                    Center
                </ToolbarButton>

                <ToolbarButton
                    onClick={onFitToView}
                    title="Fit to View"
                    icon={<FitViewIcon />}
                >
                    Fit View
                </ToolbarButton>

                <ToolbarButton
                    onClick={onResetZoom}
                    title="Reset Zoom"
                    icon={<ResetZoomIcon />}
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