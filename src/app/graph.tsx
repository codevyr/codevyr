import type { OffsetValue } from './lib/offsets';

export interface Declaration {
    id: string;
    symbol: string;
    file_id: string;
    symbol_type: string;
    start_offset: OffsetValue;
    end_offset: OffsetValue;
}

export interface Node {
    id: string;
    label: string;
    declarations: Array<Declaration>;
    color?: string;
}

export interface Edge {
    id: string;
    from: string;
    to: string;
    from_file?: string;
    from_offset_start: OffsetValue;
    from_offset_end: OffsetValue;
}

export interface GraphFile {
    path: string;
    project_id: string | null;
}

export interface Graph {
    nodes: Map<string, Node>;
    edges: Map<string, Array<Edge>>;
    files: Map<string, GraphFile>;
}
