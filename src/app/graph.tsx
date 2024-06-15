import { use, useEffect, useState } from 'react';

export interface Declaration {
    id: string;
    symbol: string;
    file_id: string;
    symbol_type: string;
    line_start: string;
    col_start: string;
    line_end: string;
    col_end: string;
}

export interface Node {
    id: string;
    label: string;
    declarations: Array<Declaration>
}

export interface Edge {
    id: string;
    from: string;
    to: string;
    from_file: string;
    from_line: string;
}

export interface Graph {
    nodes: Map<string, Node>;
    edges: Set<Edge>;
    files: Map<string, string>;
}