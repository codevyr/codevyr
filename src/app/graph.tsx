import type { OffsetValue } from './lib/offsets';

export interface SymbolInstance {
    id: string;
    symbol: string;
    object_id: string;
    symbol_type: string;
    start_offset: OffsetValue;
    end_offset: OffsetValue;
}

export interface Node {
    id: string;
    label: string;
    symbol_instances: Array<SymbolInstance>;
    color?: string;
}

export interface Edge {
    id: string;
    from: string;
    to: string;
    from_object?: string;
    from_offset_start: OffsetValue;
    from_offset_end: OffsetValue;
}

export interface GraphObject {
    path: string;
    project_id: string | null;
}

export interface Graph {
    nodes: Map<string, Node>;
    edges: Map<string, Array<Edge>>;
    objects: Map<string, GraphObject>;
}
