import { useEffect } from 'react';
import { LuArrowUpRight, LuCopy, LuFocus } from 'react-icons/lu';
import { CodeFocus } from './code_viewer';
import { Edge, SymbolInstance, Node, Graph } from './graph';
import { copyToClipboard } from './lib/clipboard';
import { formatOffsetLocation, getLineColumnFromOffset, parseOffset } from './lib/offsets';

type SymbolInstanceSortInfo = {
  path: string;
  line: number;
  column: number;
  offset: number;
};

function resolveSymbolInstanceSortInfo(
  instance: SymbolInstance,
  graph: Graph,
  fileContents: Map<string, string>,
): SymbolInstanceSortInfo {
  const path = graph.objects.get(instance.object_id)?.path ?? instance.object_id;
  const content = fileContents.get(instance.object_id);
  const location = content ? getLineColumnFromOffset(content, instance.start_offset) : null;
  const line = location?.lineNumber ?? Number.MAX_SAFE_INTEGER;
  const column = location?.column ?? Number.MAX_SAFE_INTEGER;
  const offset = parseOffset(instance.start_offset) ?? Number.MAX_SAFE_INTEGER;

  return { path, line, column, offset };
}

function compareSymbolInstances(
  left: SymbolInstance,
  right: SymbolInstance,
  graph: Graph,
  fileContents: Map<string, string>,
) {
  const leftInfo = resolveSymbolInstanceSortInfo(left, graph, fileContents);
  const rightInfo = resolveSymbolInstanceSortInfo(right, graph, fileContents);

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

interface SymbolInstanceHoverProps {
  instance: SymbolInstance;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
}

function SymbolInstanceHover({ instance, graph, setCodeFocus, fileContents }: SymbolInstanceHoverProps) {
  const filePath = graph.objects.get(instance.object_id)?.path ?? 'Undefined';
  const location = formatOffsetLocation(
    fileContents.get(instance.object_id),
    instance.start_offset,
  );

  function openInEditor() {
    setCodeFocus({
      object_id: instance.object_id,
      start_offset: instance.start_offset,
      end_offset: instance.end_offset,
    });
  }

  function copyPath() {
    void copyToClipboard(filePath);
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
          <LuArrowUpRight />
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
          <LuCopy />
        </button>
      </td>
    </tr>
  );
}

interface NodeHoverSectionProps {
  sectionName: string;
  showHeader: boolean;
  instances: SymbolInstance[];
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
}

function NodeHoverSection({
  sectionName,
  showHeader,
  instances,
  graph,
  setCodeFocus,
  fileContents,
}: NodeHoverSectionProps) {
  if (instances.length === 0) {
    return null;
  }

  const sortedInstances = [...instances].sort((left, right) =>
    compareSymbolInstances(left, right, graph, fileContents),
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
        {sortedInstances.map((instance) => (
          <SymbolInstanceHover
            key={instance.id}
            instance={instance}
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
  ensureFileContent: (objectId: string) => void;
}

export function NodeHover({
  node,
  setCodeFocus,
  focusNode,
  graph,
  fileContents,
  ensureFileContent,
}: NodeHoverProps) {
  const definitionInstances = node.symbol_instances.filter((d) => d.symbol_type === 'Definition');
  const declarationInstances = node.symbol_instances.filter((d) => d.symbol_type === 'Declaration');
  const hasBothSections = definitionInstances.length > 0 && declarationInstances.length > 0;

  useEffect(() => {
    const seen = new Set<string>();
    node.symbol_instances.forEach((instance) => {
      if (seen.has(instance.object_id)) {
        return;
      }
      seen.add(instance.object_id);
      ensureFileContent(instance.object_id);
    });
  }, [node, ensureFileContent]);

  return (
    <div className="node-hover">
      <div className="node-hover-header">
        <div className="node-hover-title" title={node.label}>
          {node.label}
        </div>
        <button type="button" className="node-hover-icon" onClick={() => focusNode(node.id)} title="Focus node">
          <LuFocus />
        </button>
        <button type="button" className="node-hover-icon" onClick={() => void copyToClipboard(node.label)} title="Copy symbol name">
          <LuCopy />
        </button>
      </div>
      <table>
        <NodeHoverSection
          sectionName="Definition"
          showHeader={hasBothSections}
          instances={definitionInstances}
          graph={graph}
          setCodeFocus={setCodeFocus}
          fileContents={fileContents}
        />
        <NodeHoverSection
          sectionName="Declaration"
          showHeader={hasBothSections}
          instances={declarationInstances}
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

function resolveEdgeObjectId(edge: Edge, graph: Graph): string | null {
  if (edge.from_object) {
    return edge.from_object;
  }

  const node = graph.nodes.get(edge.from);
  return node?.symbol_instances[0]?.object_id ?? null;
}

function resolveEdgeSortInfo(
  edge: Edge,
  graph: Graph,
  fileContents: Map<string, string>,
) {
  const objectId = resolveEdgeObjectId(edge, graph);
  const path = objectId ? graph.objects.get(objectId)?.path ?? objectId : 'Undefined';
  const content = objectId ? fileContents.get(objectId) : undefined;
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
  const objectId = resolveEdgeObjectId(edge, graph);
  const filePath = objectId ? graph.objects.get(objectId)?.path ?? objectId : 'Undefined';
  const location = formatOffsetLocation(objectId ? fileContents.get(objectId) : undefined, edge.from_offset_start);

  function openInEditor() {
    if (!objectId) {
      return;
    }
    setCodeFocus({
      object_id: objectId,
      start_offset: edge.from_offset_start,
      end_offset: edge.from_offset_end,
    });
  }

  function copyPath() {
    void copyToClipboard(filePath);
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
          <LuArrowUpRight />
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
          <LuCopy />
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
  ensureFileContent: (objectId: string) => void;
}

export function EdgesHover({ edges, setCodeFocus, graph, fileContents, ensureFileContent }: EdgesHoverProps) {
  useEffect(() => {
    edges.forEach((edge) => {
      const objectId = resolveEdgeObjectId(edge, graph);
      if (objectId) {
        ensureFileContent(objectId);
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
