import { useEffect } from 'react';
import { CodeFocus } from './code_viewer';
import { Edge, Declaration, Node, Graph } from './graph';
import { formatOffsetLocation, getLineColumnFromOffset, parseOffset } from './lib/offsets';

type DeclarationSortInfo = {
  path: string;
  line: number;
  column: number;
  offset: number;
};

function resolveDeclarationSortInfo(
  declaration: Declaration,
  graph: Graph,
  fileContents: Map<string, string>,
): DeclarationSortInfo {
  const path = graph.files.get(declaration.file_id) ?? declaration.file_id;
  const content = fileContents.get(declaration.file_id);
  const location = content ? getLineColumnFromOffset(content, declaration.start_offset) : null;
  const line = location?.lineNumber ?? Number.MAX_SAFE_INTEGER;
  const column = location?.column ?? Number.MAX_SAFE_INTEGER;
  const offset = parseOffset(declaration.start_offset) ?? Number.MAX_SAFE_INTEGER;

  return { path, line, column, offset };
}

function compareDeclarations(
  left: Declaration,
  right: Declaration,
  graph: Graph,
  fileContents: Map<string, string>,
) {
  const leftInfo = resolveDeclarationSortInfo(left, graph, fileContents);
  const rightInfo = resolveDeclarationSortInfo(right, graph, fileContents);

  const pathCompare = leftInfo.path.localeCompare(rightInfo.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }
  if (leftInfo.line !== rightInfo.line) {
    return leftInfo.line - rightInfo.line;
  }
  if (leftInfo.column !== rightInfo.column) {
    return leftInfo.column - rightInfo.column;
  }
  return leftInfo.offset - rightInfo.offset;
}

function copyToClipboard(value: string) {
  if (typeof navigator === 'undefined') {
    return;
  }
  navigator.clipboard?.writeText(value).catch(() => {});
}

interface DeclarationHoverProps {
  declaration: Declaration;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
}

function DeclarationHover({ declaration, graph, setCodeFocus, fileContents }: DeclarationHoverProps) {
  const filePath = graph.files.get(declaration.file_id) ?? 'Undefined';
  const location = formatOffsetLocation(
    fileContents.get(declaration.file_id),
    declaration.start_offset,
  );

  function openInEditor() {
    setCodeFocus({
      file_id: declaration.file_id,
      start_offset: declaration.start_offset,
      end_offset: declaration.end_offset,
    });
  }

  function copyPath() {
    copyToClipboard(filePath);
  }

  return (
    <tr className="declaration-hover" onClick={openInEditor}>
      <td>{filePath}</td>
      <td>{location}</td>
      <td className="node-hover-actions-cell">
        <button
          type="button"
          className="node-hover-icon"
          onClick={(event) => {
            event.stopPropagation();
            openInEditor();
          }}
          title="Open in editor"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3h7v7h-2V6.41L4.7 12.7 3.3 11.3 9.59 5H6V3z" />
          </svg>
        </button>
        <button
          type="button"
          className="node-hover-icon"
          onClick={(event) => {
            event.stopPropagation();
            copyPath();
          }}
          title="Copy path"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 5V2h7v9h-3V5H5z" />
            <path d="M3 4h5v2H5v6h6v-3h2v5H3z" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

interface NodeHoverSectionProps {
  sectionName: string;
  showHeader: boolean;
  declarations: Declaration[];
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
}

function NodeHoverSection({
  sectionName,
  showHeader,
  declarations,
  graph,
  setCodeFocus,
  fileContents,
}: NodeHoverSectionProps) {
  if (declarations.length === 0) {
    return null;
  }

  const sortedDeclarations = [...declarations].sort((left, right) =>
    compareDeclarations(left, right, graph, fileContents),
  );

  return (
    <>
      {showHeader && (
        <thead>
          <tr>
            <th colSpan={3}>{sectionName}</th>
          </tr>
        </thead>
      )}

      <tbody>
        {sortedDeclarations.map((declaration) => (
          <DeclarationHover
            key={declaration.id}
            declaration={declaration}
            graph={graph}
            setCodeFocus={setCodeFocus}
            fileContents={fileContents}
          />
        ))}
      </tbody>
    </>
  );
}

export interface NodeHoverProps {
  node: Node;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  focusNode: (nodeId: string) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (fileId: string) => void;
}

export function NodeHover({
  node,
  setCodeFocus,
  focusNode,
  graph,
  fileContents,
  ensureFileContent,
}: NodeHoverProps) {
  const definitionDeclarations = node.declarations.filter((d) => d.symbol_type === 'Definition');
  const declarationDeclarations = node.declarations.filter((d) => d.symbol_type === 'Declaration');
  const hasBothSections = definitionDeclarations.length > 0 && declarationDeclarations.length > 0;

  useEffect(() => {
    const seen = new Set<string>();
    node.declarations.forEach((declaration) => {
      if (seen.has(declaration.file_id)) {
        return;
      }
      seen.add(declaration.file_id);
      ensureFileContent(declaration.file_id);
    });
  }, [node, ensureFileContent]);

  return (
    <div className="node-hover">
      <div className="node-hover-header">
        <div className="node-hover-title" title={node.label}>
          {node.label}
        </div>
        <button type="button" className="node-hover-icon" onClick={() => focusNode(node.id)} title="Focus node">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 1h4v2H6zM6 13h4v2H6zM1 6h2v4H1zM13 6h2v4h-2zM5 5h6v6H5z" />
          </svg>
        </button>
        <button type="button" className="node-hover-icon" onClick={() => copyToClipboard(node.label)} title="Copy symbol name">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 5V2h7v9h-3V5H5z" />
            <path d="M3 4h5v2H5v6h6v-3h2v5H3z" />
          </svg>
        </button>
      </div>
      <table>
        <NodeHoverSection
          sectionName="Definition"
          showHeader={hasBothSections}
          declarations={definitionDeclarations}
          graph={graph}
          setCodeFocus={setCodeFocus}
          fileContents={fileContents}
        />
        <NodeHoverSection
          sectionName="Declaration"
          showHeader={hasBothSections}
          declarations={declarationDeclarations}
          graph={graph}
          setCodeFocus={setCodeFocus}
          fileContents={fileContents}
        />
      </table>
    </div>
  );
}

interface EdgeHoverProps {
  edge: Edge;
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

function resolveEdgeSortInfo(
  edge: Edge,
  graph: Graph,
  fileContents: Map<string, string>,
) {
  const fileId = resolveEdgeFileId(edge, graph);
  const path = fileId ? graph.files.get(fileId) ?? fileId : 'Undefined';
  const content = fileId ? fileContents.get(fileId) : undefined;
  const location = content ? getLineColumnFromOffset(content, edge.from_offset_start) : null;
  const line = location?.lineNumber ?? Number.MAX_SAFE_INTEGER;
  const column = location?.column ?? Number.MAX_SAFE_INTEGER;
  const offset = parseOffset(edge.from_offset_start) ?? Number.MAX_SAFE_INTEGER;
  return { path, line, column, offset };
}

function compareEdges(
  left: Edge,
  right: Edge,
  graph: Graph,
  fileContents: Map<string, string>,
) {
  const leftInfo = resolveEdgeSortInfo(left, graph, fileContents);
  const rightInfo = resolveEdgeSortInfo(right, graph, fileContents);
  const pathCompare = leftInfo.path.localeCompare(rightInfo.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }
  if (leftInfo.line !== rightInfo.line) {
    return leftInfo.line - rightInfo.line;
  }
  if (leftInfo.column !== rightInfo.column) {
    return leftInfo.column - rightInfo.column;
  }
  return leftInfo.offset - rightInfo.offset;
}

function EdgeHover({ edge, graph, setCodeFocus, fileContents }: EdgeHoverProps) {
  const fileId = resolveEdgeFileId(edge, graph);
  const filePath = fileId ? graph.files.get(fileId) ?? fileId : 'Undefined';
  const location = formatOffsetLocation(fileId ? fileContents.get(fileId) : undefined, edge.from_offset_start);

  function openInEditor() {
    if (!fileId) {
      return;
    }
    setCodeFocus({
      file_id: fileId,
      start_offset: edge.from_offset_start,
      end_offset: edge.from_offset_end,
    });
  }

  function copyPath() {
    copyToClipboard(filePath);
  }

  return (
    <tr className="declaration-hover" onClick={openInEditor}>
      <td>{filePath}</td>
      <td>{location}</td>
      <td className="node-hover-actions-cell">
        <button
          type="button"
          className="node-hover-icon"
          onClick={(event) => {
            event.stopPropagation();
            openInEditor();
          }}
          title="Open in editor"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3h7v7h-2V6.41L4.7 12.7 3.3 11.3 9.59 5H6V3z" />
          </svg>
        </button>
        <button
          type="button"
          className="node-hover-icon"
          onClick={(event) => {
            event.stopPropagation();
            copyPath();
          }}
          title="Copy path"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 5V2h7v9h-3V5H5z" />
            <path d="M3 4h5v2H5v6h6v-3h2v5H3z" />
          </svg>
        </button>
      </td>
    </tr>
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
    edges.forEach((edge) => {
      const fileId = resolveEdgeFileId(edge, graph);
      if (fileId) {
        ensureFileContent(fileId);
      }
    });
  }, [edges, graph, ensureFileContent]);

  const sortedEdges = [...edges].sort((left, right) =>
    compareEdges(left, right, graph, fileContents),
  );
  const headerEdge = sortedEdges[0];
  const fromLabel = headerEdge ? graph.nodes.get(headerEdge.from)?.label ?? headerEdge.from : null;
  const toLabel = headerEdge ? graph.nodes.get(headerEdge.to)?.label ?? headerEdge.to : null;

  return (
    <div className="node-hover">
      {headerEdge && (
        <div className="edge-hover-header">
          <div className="edge-hover-line">
            <span className="edge-hover-key">From</span>
            <span className="edge-hover-value" title={fromLabel ?? undefined}>
              {fromLabel}
            </span>
          </div>
          <div className="edge-hover-line">
            <span className="edge-hover-key">To</span>
            <span className="edge-hover-value" title={toLabel ?? undefined}>
              {toLabel}
            </span>
          </div>
        </div>
      )}
      <table>
        <tbody>
          {sortedEdges.map((edge) => (
            <EdgeHover
              key={`${edge.id}-${edge.from_offset_start}`}
              edge={edge}
              graph={graph}
              setCodeFocus={setCodeFocus}
              fileContents={fileContents}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
