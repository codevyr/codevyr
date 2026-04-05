import { useEffect } from 'react';
import { LuArrowUpRight, LuCopy, LuFocus, LuFolderOpen } from 'react-icons/lu';
import { CodeFocus } from './code_viewer';
import { Edge, SymbolInstance, Node, Graph, isDirectoryInstance, isSelfReference } from './graph';
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
  onAction?: () => void;
}

function SymbolInstanceHover({ instance, graph, setCodeFocus, fileContents, onAction }: SymbolInstanceHoverProps) {
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
    onAction?.();
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
  instances: SymbolInstance[];
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
  onAction?: () => void;
}

function capitalizeInstanceType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function NodeHoverSection({
  sectionName,
  instances,
  graph,
  setCodeFocus,
  fileContents,
  onAction,
}: NodeHoverSectionProps) {
  if (instances.length === 0) {
    return null;
  }

  const sortedInstances = [...instances].sort((left, right) =>
    compareSymbolInstances(left, right, graph, fileContents),
  );

  return (
    <>
      <thead>
        <tr>
          <th colSpan={3}>{sectionName}</th>
        </tr>
      </thead>

      <tbody>
        {sortedInstances.map((instance) => (
          <SymbolInstanceHover
            key={instance.id}
            instance={instance}
            graph={graph}
            setCodeFocus={setCodeFocus}
            fileContents={fileContents}
            onAction={onAction}
          />
        ))}
      </tbody>
    </>
  );
}

const INSTANCE_TYPE_ORDER: Record<string, number> = {
  sentinel: 1,
  header: 2,
  source: 3,
  build: 4,
  file: 5,
  containment: 6,
  documentation: 7,
  declaration: 8,
  definition: 9,
  expansion: 10,
};

export interface NodeHoverProps {
  node: Node;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  focusNode: (nodeId: string) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  isGroupNode?: boolean;
  revealDirectory?: (objectId: string) => void;
  hiddenRefEdges?: Array<Edge>;
  onAction?: () => void;
}

export function NodeHover({
  node,
  setCodeFocus,
  focusNode,
  graph,
  fileContents,
  ensureFileContent,
  isGroupNode,
  revealDirectory,
  hiddenRefEdges,
  onAction,
}: NodeHoverProps) {
  // For group nodes, separate directory instances from real code references
  const realInstances = isGroupNode
    ? node.symbol_instances.filter((inst) => !isDirectoryInstance(inst))
    : node.symbol_instances;
  const selfRefInstance = isGroupNode
    ? node.symbol_instances.find((inst) => isSelfReference(inst)) ?? node.symbol_instances.find((inst) => isDirectoryInstance(inst))
    : undefined;

  // Group instances by instance_type, skipping "unspecified"
  const instancesByType = new Map<string, SymbolInstance[]>();
  realInstances.forEach((instance) => {
    const type = instance.instance_type;
    if (type === 'unspecified') return;
    if (!instancesByType.has(type)) {
      instancesByType.set(type, []);
    }
    instancesByType.get(type)!.push(instance);
  });

  useEffect(() => {
    const seen = new Set<string>();
    realInstances.forEach((instance) => {
      if (seen.has(instance.object_id)) {
        return;
      }
      seen.add(instance.object_id);
      ensureFileContent(instance.object_id);
    });
    hiddenRefEdges?.forEach((edge) => {
      const objectId = resolveEdgeObjectId(edge, graph);
      if (objectId && !seen.has(objectId)) {
        seen.add(objectId);
        ensureFileContent(objectId);
      }
    });
  }, [node, ensureFileContent, realInstances, hiddenRefEdges, graph]);

  const dirPath = selfRefInstance
    ? graph.objects.get(selfRefInstance.object_id)?.path
    : undefined;

  return (
    <div className="node-hover">
      <div className="node-hover-header">
        <div className="node-hover-title" title={node.label}>
          {node.label}
        </div>
        {isGroupNode && revealDirectory && selfRefInstance && (
          <button
            type="button"
            className="node-hover-icon"
            onClick={() => revealDirectory(selfRefInstance.object_id)}
            title="Reveal in tree"
          >
            <LuFolderOpen />
          </button>
        )}
        <button type="button" className="node-hover-icon" onClick={() => focusNode(node.id)} title="Focus node">
          <LuFocus />
        </button>
        <button type="button" className="node-hover-icon" onClick={() => { void copyToClipboard(node.label); onAction?.(); }} title="Copy symbol name">
          <LuCopy />
        </button>
      </div>
      {isGroupNode && realInstances.length === 0 && dirPath && (
        <div className="node-hover-dir-path">{dirPath}</div>
      )}
      <table>
        {Array.from(instancesByType.entries())
          .sort(([a], [b]) => (INSTANCE_TYPE_ORDER[a] ?? 99) - (INSTANCE_TYPE_ORDER[b] ?? 99))
          .map(([typeName, instances]) => (
          <NodeHoverSection
            key={typeName}
            sectionName={capitalizeInstanceType(typeName)}
            instances={instances}
            graph={graph}
            setCodeFocus={setCodeFocus}
            fileContents={fileContents}
            onAction={onAction}
          />
        ))}
      </table>
      {hiddenRefEdges && hiddenRefEdges.length > 0 && (
        <table>
          <thead>
            <tr>
              <th colSpan={3}>References</th>
            </tr>
          </thead>
          <tbody>
            {[...hiddenRefEdges]
              .sort((a, b) => compareEdges(a, b, graph, fileContents))
              .map((edge) => (
                <EdgeHover
                  key={`${edge.id}-${edge.from_offset_start}`}
                  edge={edge}
                  graph={graph}
                  setCodeFocus={setCodeFocus}
                  fileContents={fileContents}
                  onAction={onAction}
                />
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface EdgeHoverProps {
  edge: Edge;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
  onAction?: () => void;
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

function EdgeHover({ edge, graph, setCodeFocus, fileContents, onAction }: EdgeHoverProps) {
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
    onAction?.();
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
  onAction?: () => void;
}

export function EdgesHover({ edges, setCodeFocus, graph, fileContents, ensureFileContent, onAction }: EdgesHoverProps) {
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
              onAction={onAction}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
