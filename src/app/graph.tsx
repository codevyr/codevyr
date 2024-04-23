import { use, useEffect, useState } from 'react';

export interface Node {
    id: string;
    label: string;
    uri: string;
    loc: string;
}

export interface Edge {
    id: string;
    from: string;
    to: string;
    from_file: string;
    from_line: string;
}

export interface Graph {
    nodes: Set<Node>;
    edges: Set<Edge>;
}