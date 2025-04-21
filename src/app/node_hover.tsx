import { CodeFocus } from './code_viewer';
import { Edge, Declaration, Node, Graph } from './graph';

interface DeclarationHoverProps {
    declaration: Declaration
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
}

function DeclarationHover({ declaration, graph, setCodeFocus }: DeclarationHoverProps) {
    function clickDeclaration(event: React.MouseEvent<HTMLElement>) {
        setCodeFocus({
            file_id: declaration.file_id,
            line: declaration.line_start
        })
    }

    console.log("GRAPH IS", declaration, graph)
    const file_path = graph.files.get(declaration.file_id) ?? "Undefined";
    return (
        <>
            <tr onClick={clickDeclaration} className='declaration-hover'>
                <td>{file_path}</td>
                <td>{declaration.line_start}:{declaration.col_start}</td>
            </tr>
        </>
    );
}

interface NodeHoverSectionProps {
    sectionName: string;
    node: Node;
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
}

function NodeHoverSection({ sectionName, node, graph, setCodeFocus }: NodeHoverSectionProps) {
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
                    <DeclarationHover key={declaration.id} declaration={declaration} graph={graph} setCodeFocus={setCodeFocus} />
                )}
            </tbody>
        </>
    );
}

export interface NodeHoverProps {
    node: Node;
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
}

export function NodeHover({ node, setCodeFocus, graph }: NodeHoverProps) {
    return (
        <div className="node-hover">
            <table>
                <NodeHoverSection sectionName="Definition" node={node} graph={graph} setCodeFocus={setCodeFocus} />
                <NodeHoverSection sectionName="Declaration" node={node} graph={graph} setCodeFocus={setCodeFocus} />
            </table>
        </div>
    );
}

interface EdgeHoverProps {
    edge: Edge
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
}

function EdgeHover({ edge, graph, setCodeFocus }: EdgeHoverProps) {
    function clickDeclaration(event: React.MouseEvent<HTMLElement>) {
        setCodeFocus({
            file_id: edge.from_file,
            line: edge.from_line
        })
    }

    const file_path = graph.files.get(edge.from_file) ?? "Undefined";
    return (
        <>
            <tr onClick={clickDeclaration} className='declaration-hover'>
                <td>{file_path}</td>
                <td>{edge.from_line}</td>
            </tr>
        </>
    );
}

export interface EdgesHoverProps {
    edges: Array<Edge>;
    graph: Graph;
    setCodeFocus: (type: CodeFocus) => void;
}

export function EdgesHover({ edges, setCodeFocus, graph }: EdgesHoverProps) {
    return (
        <div className="node-hover">
            <table>
                <tbody>
                    {edges.map((edge: Edge) =>
                        <EdgeHover key={edge.id+'-'+edge.from_line} edge={edge} graph={graph} setCodeFocus={setCodeFocus} />
                    )}
                </tbody>
            </table>
        </div>
    );
}