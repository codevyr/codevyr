import CytoscapeComponent from 'react-cytoscapejs';
import Cytoscape, { ElementDefinition, NodeSingular } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import React, { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Edge, Graph, Node } from './graph';
import cytoscapePopper, { RefElement, PopperOptions, PopperInstance } from 'cytoscape-popper';
import {
    computePosition,
    flip,
    shift,
    limitShift,
    ComputePositionConfig,
} from '@floating-ui/dom';
import { EdgesHover, NodeHover } from './node_hover';
import { createRoot } from 'react-dom/client';
import tippy, { followCursor, sticky, Instance, Props } from 'tippy.js';
import { CodeFocus } from './code_viewer';


export interface GraphProps {
    graph: Graph;
    onFocus: (type: CodeFocus | null) => void;
}

Cytoscape.use(dagre)

declare module 'cytoscape-popper' {
    interface PopperOptions extends ComputePositionConfig {
    }
    interface PopperInstance extends Instance<Props> {
    }
}

function tippyFactory(ref: RefElement, content: HTMLElement, options?: PopperOptions): PopperInstance {
    // Since tippy constructor requires DOM element/elements, create a placeholder
    var dummyDomEle = document.createElement('div');

    var tip = tippy(dummyDomEle, {
        getReferenceClientRect: ref.getBoundingClientRect,
        trigger: 'manual', // mandatory
        // dom element inside the tippy:
        followCursor: true,
        content: content,
        // your own preferences:
        arrow: true,
        placement: 'bottom',
        hideOnClick: false,
        sticky: "reference",

        // if interactive:
        interactive: true,
        appendTo: document.body, // or append dummyDomEle to document.body
        plugins: [followCursor, sticky],
    });

    return tip;
}

Cytoscape.use(cytoscapePopper(tippyFactory));

const createContentFromComponent = (id: string, component: ReactNode) => {
    const div = document.createElement('div');

    console.log("Create hover")
    const root = createRoot(div, { identifierPrefix: id });
    root.render(component);
    // div.classList.add('popper-div');
    document.body.appendChild(div);
    return div;
};

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
                new_node_coll = new_node_coll.union(cy.add({ data: { id: String(node.id), label: node.label } }))
                new_nodes.push(node)
            }
        });

        graph.edges.forEach((edgeArray: Array<Edge>) => {
            edgeArray.forEach((edge: Edge) => {
                new_nodes.forEach((node: Node) => {
                    if ((edge.from === node.id) || (edge.to === node.id)) {
                        if (cy.edges('#' + edge.from + '-' + edge.to).empty()) {
                            cy.add({ data: { id: edge.from + '-' + edge.to, source: edge.from, target: edge.to } });
                        }
                    }
                })
            })
        });

        cy.nodes().difference(new_node_coll).lock()

        console.log("layout", new_node_coll)
        cy.layout(layout).run();
        cy.nodes().difference(new_node_coll).unlock()

        cy.nodes().forEach(function (node) {
            const node_id = node.data("id");
            const graph_node: Node | undefined = graph.nodes.get(node_id);
            if (!graph_node) {
                console.error("Did not find node: ", node_id);
                return;
            }

            var tip = node.popper({
                content: () => createContentFromComponent(node_id, <NodeHover node={graph_node} graph={graph} setCodeFocus={onFocus} />),
            });

            node.off('tap');
            node.on('tap', function (evt) {
                var node_id = evt.target.id();

                // If we show the tip already, only need to hide
                if (tip.state.isVisible) {
                    tip.hide()
                    return
                }

                let node = graph.nodes.get(node_id);
                if (!node) {
                    console.log("Node is undefined")
                    return;
                }

                // There are no declarations. Maybe some fake node?
                if (node.declarations.length == 0) {
                    console.warn("Node without declarations")
                    return;
                }

                // Only one declaration, just jump to the location
                if (node.declarations.length == 1) {
                    let decl = node.declarations[0];

                    onFocus({
                        file_id: decl.file_id,
                        line: decl.line_start
                    });
                    return;
                }

                // If more than one node, then need to show the tip
                tip.show();
            });
        })

        cy.edges().forEach(function (edge) {
            const edge_id = edge.data("id");
            const graph_edges: Array<Edge> | undefined = graph.edges.get(edge_id);
            if (!graph_edges) {
                console.error("Did not find node: ", edge_id);
                return;
            }

            var tip = edge.popper({
                content: () => createContentFromComponent(edge_id, <EdgesHover edges={graph_edges} graph={graph} setCodeFocus={onFocus} />),
            });

            edge.off('tap');
            edge.on('tap', function (evt) {
                var edge_id = evt.target.id();

                // If we show the tip already, only need to hide
                if (tip.state.isVisible) {
                    tip.hide()
                    return
                }

                let edges = graph.edges.get(edge_id);
                if (!edges) {
                    console.log("Node is undefined")
                    return;
                }

                // There are no declarations. Maybe some fake node?
                if (edges.length == 0) {
                    console.warn("Node without declarations")
                    return;
                }

                // Only one declaration, just jump to the location
                if (edges.length == 1) {
                    let e = edges[0];

                    onFocus({
                        file_id: e.from_file,
                        line: e.from_line
                    });
                    return;
                }

                // If more than one node, then need to show the tip
                tip.show();
            });
        })
    }, [onFocus, graph, layout]);

    function cytoscapeHandler(cy: Cytoscape.Core) {
        cyRef.current = cy;
    }

    console.log('Regenerate is', graph, stylesheet);
    return <CytoscapeComponent elements={[]} stylesheet={stylesheet} style={{ width: '100%', height: '100%' }} cy={cytoscapeHandler} layout={layout} />;
}