import React from 'react';

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
        <div className="flex items-center gap-2 p-2 bg-gray-100 border-b border-gray-300 shadow-sm">
            <div className="flex items-center gap-2">
                <button
                    onClick={onRerunLayout}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    title="Rerun Layout"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Layout
                </button>

                <button
                    onClick={onCenterGraph}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    title="Center Graph"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m0-18l4 4m-4-4L8 7" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h18m-18 0l4-4m-4 4l4 4" />
                    </svg>
                    Center
                </button>

                <button
                    onClick={onFitToView}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    title="Fit to View"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                    Fit View
                </button>

                <button
                    onClick={onResetZoom}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    title="Reset Zoom"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                    </svg>
                    Reset Zoom
                </button>
            </div>

            <div className="flex-1"></div>

            <div className="flex items-center text-xs text-gray-500">
                <span>Graph Controls</span>
            </div>
        </div>
    );
}