import CytoscapeComponent from 'react-cytoscapejs';
import Cytoscape, { ElementDefinition } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import React, { useEffect, useMemo, useRef } from 'react';
import { Edge, Graph, Node } from './graph';

export interface GraphProps {
    graph: Graph;
    onFocus: any;
}

Cytoscape.use(dagre)

export function GraphViewer({ graph, onFocus }: GraphProps) {
    let cyRef = useRef<Cytoscape.Core | null>(null);

    const layout = useMemo(() => ({
        name: 'dagre',
        directed: true,
        fit: true,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        padding: 40
    }), []);

    const stylesheet = useMemo(() =>
        [
            {
                selector: 'node',
                style: {
                    'content': 'data(label)',
                    'text-valign': 'center',
                    'color': 'black',
                    'background-color': '#91c7fe'
                }
            },

            {
                selector: 'edge',
                style: {
                    'width': 4,
                    'target-arrow-shape': 'triangle',
                    'line-color': '#9dbaea',
                    'target-arrow-color': '#9dbaea',
                    'curve-style': 'bezier'
                }
            }
        ], []);

    useEffect(() => {
        if (cyRef.current) {
            cyRef.current.layout(layout).run();
        }
    }, [graph, layout]);

    function cytoscapeHandler(cy: Cytoscape.Core) {

        cyRef.current = cy;

        cy.off('tap', 'node');
        cy.on('tap', 'node', function (evt) {
            var node_id = evt.target.id();
            graph.nodes.forEach((n: Node) => {
                if (n.id === node_id) {
                    console.log('node is', n, n.loc);
                    onFocus({
                        uri: n.uri,
                        loc: n.loc
                    });
                }
            });
        });

        cy.off('tap', 'edge');
        cy.on('tap', 'edge', function (evt) {
            console.log(evt);
            var edge_id = evt.target.id();
            console.log(edge_id);
            graph.edges.forEach((e: Edge) => {
                if (e.id === edge_id) {
                    onFocus({
                        uri: e.from_file,
                        loc: e.from_line
                    });
                }
            });
        });
    }

    function cytoscapeElements(graph: Graph): ElementDefinition[] {
        let elements: ElementDefinition[] = [];
        graph.nodes.forEach((node: Node) => {
            elements.push({ data: { id: node.id, label: node.label } });
        });

        graph.edges.forEach((edge: Edge) => {
            elements.push({ data: { id: edge.from + '-' + edge.to, source: edge.from, target: edge.to } });
        });

        return elements;
    }

    console.log('Regenerate is', graph, stylesheet);
    return <CytoscapeComponent elements={cytoscapeElements(graph)} stylesheet={stylesheet} style={{ width: '100%', height: '100%' }} cy={cytoscapeHandler} layout={layout} />;
}