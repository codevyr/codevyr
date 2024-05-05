import { use, useEffect, useState } from 'react';

export interface Node {
    id: string;
    label: string;
    file_id: string;
    line: string;
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
}