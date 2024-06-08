import { CodeFocus } from './code_viewer';
import { Edge, Declaration, Node } from './graph';

interface DeclarationHoverProps {
    declaration: Declaration
    setCodeFocus: (type: CodeFocus) => void;
}

function DeclarationHover({ declaration, setCodeFocus }: DeclarationHoverProps) {
    function clickDeclaration(event: React.MouseEvent<HTMLElement>) {
        setCodeFocus({
            file_id: declaration.file_id,
            line: declaration.line_start
        })
    }

    return (
        <>
            <tr onClick={clickDeclaration} className='declaration-hover'>
                <td>{declaration.file_id}</td>
                <td>{declaration.line_start}:{declaration.col_start}</td>
            </tr>
        </>
    );
}

interface NodeHoverSectionProps {
    sectionName: string;
    node: Node;
    setCodeFocus: (type: CodeFocus) => void;
}

function NodeHoverSection({ sectionName, node, setCodeFocus }: NodeHoverSectionProps) {
    const declarations = node.declarations.filter((d) => d.symbol_type === sectionName)
    return (
        <div>
            <tr>
                <th>{sectionName}</th>
            </tr>

            {declarations.map(declaration =>
                <DeclarationHover key={declaration.id} declaration={declaration} setCodeFocus={setCodeFocus} />
            )}
        </div>
    );
}

export interface NodeHoverProps {
    node: Node;
    setCodeFocus: (type: CodeFocus) => void;
}

export function NodeHover({ node, setCodeFocus }: NodeHoverProps) {
    return (
        <div className="node-hover">
            <table>
                <NodeHoverSection sectionName="Definition" node={node} setCodeFocus={setCodeFocus} />
                <NodeHoverSection sectionName="Declaration" node={node} setCodeFocus={setCodeFocus} />
            </table>
        </div>
    );
}