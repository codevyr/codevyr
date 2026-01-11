import { useEffect } from 'react';
import { CodeFocus } from './code_viewer';
import { Edge, Declaration, Node, Graph } from './graph';
import { formatOffsetLocation } from './lib/offsets';

interface DeclarationHoverProps {
    declaration: Declaration
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
    fileContents: Map<string, string>;
}

function DeclarationHover({ declaration, graph, setCodeFocus, fileContents }: DeclarationHoverProps) {
    function clickDeclaration(event: React.MouseEvent<HTMLElement>) {
        setCodeFocus({
            file_id: declaration.file_id,
            start_offset: declaration.start_offset,
            end_offset: declaration.end_offset,
        })
    }

    console.log("GRAPH IS", declaration, graph)
    const file_path = graph.files.get(declaration.file_id) ?? "Undefined";
    const location = formatOffsetLocation(fileContents.get(declaration.file_id), declaration.start_offset);
    return (
        <>
            <tr onClick={clickDeclaration} className='declaration-hover'>
                <td>{file_path}</td>
                <td>{location}</td>
            </tr>
        </>
    );
}

interface NodeHoverSectionProps {
    sectionName: string;
    node: Node;
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
    fileContents: Map<string, string>;
}

function NodeHoverSection({ sectionName, node, graph, setCodeFocus, fileContents }: NodeHoverSectionProps) {
    const declarations = node.declarations.filter((d) => d.symbol_type === sectionName)
    return (
        <>
            <thead>
                <tr>
                    <th>{sectionName}</th>
                </tr>
            </thead>

            <tbody>
                {declarations.map(declaration =>
                    <DeclarationHover key={declaration.id} declaration={declaration} graph={graph} setCodeFocus={setCodeFocus} fileContents={fileContents} />
                )}
            </tbody>
        </>
    );
}

export interface NodeHoverProps {
    node: Node;
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
    fileContents: Map<string, string>;
    ensureFileContent: (fileId: string) => void;
}

export function NodeHover({ node, setCodeFocus, graph, fileContents, ensureFileContent }: NodeHoverProps) {
    useEffect(() => {
        const seen = new Set<string>();
        node.declarations.forEach(declaration => {
            if (seen.has(declaration.file_id)) {
                return;
            }
            seen.add(declaration.file_id);
            ensureFileContent(declaration.file_id);
        });
    }, [node, ensureFileContent]);

    return (
        <div className="node-hover">
            <table>
                <NodeHoverSection sectionName="Definition" node={node} graph={graph} setCodeFocus={setCodeFocus} fileContents={fileContents} />
                <NodeHoverSection sectionName="Declaration" node={node} graph={graph} setCodeFocus={setCodeFocus} fileContents={fileContents} />
            </table>
        </div>
    );
}

interface EdgeHoverProps {
    edge: Edge
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
    fileContents: Map<string, string>;
}

function resolveEdgeFileId(edge: Edge, graph: Graph): string | null {
    if (edge.from_file) {
        return edge.from_file;
    }

    const node = graph.nodes.get(edge.from);
    return node?.declarations[0]?.file_id ?? null;
}

function EdgeHover({ edge, graph, setCodeFocus, fileContents }: EdgeHoverProps) {
    function clickDeclaration(event: React.MouseEvent<HTMLElement>) {
        const fileId = resolveEdgeFileId(edge, graph);
        if (!fileId) {
            return;
        }
        setCodeFocus({
            file_id: fileId,
            start_offset: edge.from_offset_start,
            end_offset: edge.from_offset_end,
        })
    }

    const fileId = resolveEdgeFileId(edge, graph);
    const file_path = fileId ? graph.files.get(fileId) ?? fileId : "Undefined";
    const location = formatOffsetLocation(fileId ? fileContents.get(fileId) : undefined, edge.from_offset_start);
    return (
        <>
            <tr onClick={clickDeclaration} className='declaration-hover'>
                <td>{file_path}</td>
                <td>{location}</td>
            </tr>
        </>
    );
}

export interface EdgesHoverProps {
    edges: Array<Edge>;
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
    fileContents: Map<string, string>;
    ensureFileContent: (fileId: string) => void;
}

export function EdgesHover({ edges, setCodeFocus, graph, fileContents, ensureFileContent }: EdgesHoverProps) {
    useEffect(() => {
        edges.forEach(edge => {
            const fileId = resolveEdgeFileId(edge, graph);
            if (fileId) {
                ensureFileContent(fileId);
            }
        });
    }, [edges, graph, ensureFileContent]);

    return (
        <div className="node-hover">
            <table>
                <tbody>
                    {edges.map((edge: Edge) =>
                        <EdgeHover key={edge.id+'-'+edge.from_offset_start} edge={edge} graph={graph} setCodeFocus={setCodeFocus} fileContents={fileContents} />
                    )}
                </tbody>
            </table>
        </div>
    );
}
