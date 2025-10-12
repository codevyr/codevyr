import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape, { NodeSingular, SingularElementReturnValue } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import React, { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { Edge, Graph, Node } from './graph';
import {
    ReferenceElement,
    computePosition,
    flip,
    shift,
    limitShift,
    ComputePositionConfig,
} from '@floating-ui/dom';
import popper from 'cytoscape-popper';
import { EdgesHover, NodeHover } from './node_hover';
import { createRoot } from 'react-dom/client';
import { CodeFocus } from './code_viewer';
import { GraphToolbar } from './graph_toolbar';
import { Instance as PopperInstance } from '@popperjs/core';

export interface GraphProps {
    graph: Graph;
    selectFile: (codeFocus: CodeFocus) => void;
}


const initCytoscape = (() => {
  let done = false;
  return () => {
    if (done) return;
    cytoscape.use(dagre);
    cytoscape.use(popper);
    done = true;
  };
})();

// Initialize cytoscape extensions once
initCytoscape();

const createContentFromComponent = (
    id: string,
    component: ReactNode,
    onCleanupReady: (cleanup: () => void) => void,
) => {
    const divElement = document.createElement('div');
    const root = createRoot(divElement, { identifierPrefix: id });
    root.render(component);
    document.body.appendChild(divElement);
    
    // Create cleanup function and pass it to the callback
    const cleanup = () => {
        root.unmount();
        if (divElement.parentNode) {
            divElement.parentNode.removeChild(divElement);
        }
    };
    
    onCleanupReady(cleanup);
    
    return divElement;
};

export function GraphViewer({ graph, selectFile }: GraphProps) {
    let cyRef = useRef<cytoscape.Core | null>(null);
    let activeTipRef = useRef<PopperInstance | null>(null);
    let activeTipCleanupRef = useRef<(() => void) | null>(null);

    const hideActiveTip = useCallback(() => {
        if (activeTipRef.current) {
            activeTipRef.current.destroy();
            activeTipRef.current = null;
        }

        if (activeTipCleanupRef.current) {
            activeTipCleanupRef.current();
            activeTipCleanupRef.current = null;
        }
    }, []);

    const showTipForElement = useCallback(
        (
            element: SingularElementReturnValue,
            id: string,
            renderContent: () => ReactNode,
        ) => {
            let tipCleanup: (() => void) | null = null;
            const tip = element.popper({
                content: () =>
                    createContentFromComponent(id, renderContent(), (cleanup) => {
                        tipCleanup = cleanup;
                    }),
            });

            if (typeof tip.update === 'function') {
                tip.update();
            } else if (typeof (tip as any).forceUpdate === 'function') {
                (tip as any).forceUpdate();
            }

            activeTipRef.current = tip;
            activeTipCleanupRef.current = () => {
                if (tipCleanup) {
                    tipCleanup();
                    tipCleanup = null;
                }
            };
        },
        [],
    );

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
                    'content': 'data(label)' as any,
                    'text-valign': 'center' as any,
                    'color': 'black',
                    'background-color': '#91c7fe'
                }
            },

            {
                selector: 'edge',
                style: {
                    'width': 4,
                    'target-arrow-shape': 'triangle' as any,
                    'line-color': '#9dbaea',
                    'target-arrow-color': '#9dbaea',
                    'curve-style': 'bezier' as any
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

        hideActiveTip();
        
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

        graph.edges.forEach((edgeArray: Array<Edge>, edgeId: string) => {
            edgeArray.forEach((edge: Edge) => {
                if (cy.edges('#' + edgeId).empty()) {
                    cy.add({ data: { id: edgeId, source: edge.from, target: edge.to } });
                }
            })
        });

        cy.nodes().difference(new_node_coll).lock()
        if (!new_node_coll.empty()) {
            cy.layout(layout).run();
        }
        cy.nodes().difference(new_node_coll).unlock()

        cy.nodes().forEach(function (node) {
            const node_id = node.data("id");
            const graph_node: Node | undefined = graph.nodes.get(node_id);
            if (!graph_node) {
                console.error("Did not find node: ", node_id);
                return;
            }

            node.off('tap');
            node.on('tap', function (evt) {
                var tappedNodeId = evt.target.id();

                hideActiveTip();

                let nodeData = graph.nodes.get(tappedNodeId);
                if (!nodeData) {
                    console.log("Node is undefined")
                    return;
                }

                if (nodeData.declarations.length === 0) {
                    console.warn("Node without declarations")
                    return;
                }

                if (nodeData.declarations.length === 1) {
                    let decl = nodeData.declarations[0];

                    selectFile({
                        file_id: decl.file_id,
                        line: decl.line_start
                    });
                    return;
                }

                showTipForElement(
                    evt.target,
                    `node-${node_id}`,
                    () => <NodeHover node={nodeData} graph={graph} setCodeFocus={selectFile} />,
                );
            });
        })

        cy.edges().forEach(function (edge) {
            const edge_id = edge.data("id");
            const graph_edges: Array<Edge> | undefined = graph.edges.get(edge_id);
            if (!graph_edges) {
                console.error("Did not find node: ", edge_id);
                return;
            }

            edge.off('tap');
            edge.on('tap', function (evt) {
                var tappedEdgeId = evt.target.id();

                hideActiveTip();

                let edges = graph.edges.get(tappedEdgeId);
                if (!edges) {
                    console.log("Node is undefined")
                    return;
                }

                if (edges.length === 0) {
                    console.warn("Node without declarations")
                    return;
                }

                if (edges.length === 1) {
                    let e = edges[0];

                    selectFile({
                        file_id: e.from_file,
                        line: e.from_line
                    });
                    return;
                }

                showTipForElement(
                    evt.target,
                    `edge-${edge_id}`,
                    () => <EdgesHover edges={edges} graph={graph} setCodeFocus={selectFile} />,
                );
            });
        })
    }, [selectFile, graph, layout, hideActiveTip, showTipForElement]);

    // Cleanup function to hide active tip on unmount
    useEffect(() => {
        return () => {
            hideActiveTip();
            cyRef.current = null;
        };
    }, [hideActiveTip]);

    function cytoscapeHandler(cy: cytoscape.Core) {
        cyRef.current = cy;
    }

    // Graph control functions
    const handleRerunLayout = useCallback(() => {
        if (cyRef.current) {
            const cy = cyRef.current;
            // Hide any active tips first
            hideActiveTip();

            // Rerun the layout on all nodes
            cy.layout(layout).run();
        }
    }, [layout, hideActiveTip]);

    const handleCenterGraph = useCallback(() => {
        if (cyRef.current) {
            cyRef.current.center();
        }
    }, []);

    const handleFitToView = useCallback(() => {
        if (cyRef.current) {
            cyRef.current.fit(undefined, 50); // 50px padding
        }
    }, []);

    const handleResetZoom = useCallback(() => {
        if (cyRef.current) {
            cyRef.current.zoom(1);
            cyRef.current.center();
        }
    }, []);

    console.log('Regenerate is', graph, stylesheet);
    const shouldExposeMetadata = process.env.NODE_ENV !== 'production';

    return (
        <div className="flex flex-col h-full">
            {shouldExposeMetadata && (
                <div
                    aria-hidden="true"
                    data-testid="graph-metadata"
                    data-node-count={graph.nodes.size}
                    style={{ display: 'none' }}
                />
            )}
            <GraphToolbar
                onRerunLayout={handleRerunLayout}
                onCenterGraph={handleCenterGraph}
                onFitToView={handleFitToView}
                onResetZoom={handleResetZoom}
            />
            <div className="flex-1">
                <CytoscapeComponent
                    elements={[]}
                    stylesheet={stylesheet}
                    style={{ width: '100%', height: '100%' }}
                    cy={cytoscapeHandler}
                    layout={layout}
                    wheelSensitivity={0.5}
                />
            </div>
        </div>
    );
}
