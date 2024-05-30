import CytoscapeComponent from 'react-cytoscapejs';
import Cytoscape, { ElementDefinition, NodeSingular } from 'cytoscape';
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

    useEffect(() => {
        if (!cyRef.current) {
            return
        }
        // When running layout, we should not move the existing nodes, because
        // the user may have put them in some sensible position.
        //
        // So, when receiving the new graph, we need to find what existing nodes
        // belong to the new graph and lock them (overlapped_collection). Then,
        // we need to remove the nodes which are not in the new graph
        // (removed_collection). And, finally, add the new nodes.

        let cy = cyRef.current
        let removed_collection = cy.collection()
        let overlapped_collection = cy.collection()
        cyRef.current.nodes().forEach((ele: NodeSingular) => {
            let id = ele.data('id')

            if (!graph.nodes.has(id)) {
                removed_collection = removed_collection.union(ele)
            } else {
                overlapped_collection = overlapped_collection.union(ele)
            }
        })
        cyRef.current.remove(removed_collection)

        let new_nodes: Node[] = []
        let new_node_coll = cy.collection()
        graph.nodes.forEach((node: Node) => {

            if (cy.nodes('#' + node.id).empty()) {
                new_node_coll = new_node_coll.union(cy.add({ data: { id: node.id, label: node.label } }))
                new_nodes.push(node)
            }
        });

        graph.edges.forEach((edge: Edge) => {
            new_nodes.forEach((node: Node) => {
                if ((edge.from === node.id) || (edge.to === node.id)) {
                    if (cy.edges('#' + edge.from + '-' + edge.to).empty()) {
                        cy.add({ data: { id: edge.from + '-' + edge.to, source: edge.from, target: edge.to } });
                    }
                }
            })
        });

        cy.nodes().difference(new_node_coll).lock()

        console.log("layout", new_node_coll)
        cy.layout(layout).run();
        cy.nodes().difference(new_node_coll).unlock()
    }, [graph, layout]);

    function cytoscapeHandler(cy: Cytoscape.Core) {

        cyRef.current = cy;

        cy.off('tap', 'node');
        cy.on('tap', 'node', function (evt) {
            var node_id = evt.target.id();
            console.log(typeof(node_id))
            let node = graph.nodes.get(node_id);
            if (!node) {
                console.log("Node is undefined")
                return;
            }
            
            let decl = node.declarations[0];
            console.log('node declaration', decl);

            onFocus({
                file_id: decl.file_id,
                line: decl.line_start
            });
        });

        cy.off('tap', 'edge');
        cy.on('tap', 'edge', function (evt) {
            console.log(evt);
            var edge_id = evt.target.id();
            console.log(edge_id);
            graph.edges.forEach((e: Edge) => {
                if (e.id === edge_id) {
                    console.log("EDGE", e)
                    onFocus({
                        file_id: e.from_file,
                        line: e.from_line
                    });
                }
            });
        });
    }

    console.log('Regenerate is', graph, stylesheet);
    return <CytoscapeComponent elements={[]} stylesheet={stylesheet} style={{ width: '100%', height: '100%' }} cy={cytoscapeHandler} layout={layout} />;
}