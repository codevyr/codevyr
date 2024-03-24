import { use, useEffect, useState } from 'react';

export interface Node {
    id: string;
    label: string;
    uri: string;
    loc: string;
}

export interface Edge {
    from: string;
    to: string;
    from_loc: string;
}

export interface Graph {
    nodes: Set<Node>;
    edges: Set<Edge>;
}