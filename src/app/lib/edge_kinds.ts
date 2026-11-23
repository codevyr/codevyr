/**
 * What an edge does, and how the graph draws it.
 *
 * The engine says of every edge what its references state about the target:
 * `kinds`, the words `calls`, `writes`, `takes`, `reads`, `declares`, `holds`
 * in that order, and `refers`, false only for a pair no token of the source
 * names (the slot holds it, the macro declared it, and nothing else).  An
 * index written before references said any of this sends neither, and such
 * an edge is drawn exactly as it always was.
 *
 * THE LINE IS DRAWN FOR THE FIRST WORD, AND THE LABEL SAYS ALL OF THEM.  A
 * pair is drawn once, with every relationship it has: the engine does not
 * choose which to show, and neither does this file.  It is the only place
 * that knows a word from a line; everything else asks it.
 */

/** What the engine states of an edge (`SkeletonEdge.kinds` / `.refers`). */
export interface EdgeStatement {
  kinds?: ReadonlyArray<string>;
  refers?: boolean;
}

/**
 * The four lines an edge can be drawn with.
 *
 * - `plain`: nothing stated.  The edge as it was before any index stated
 *   anything.
 * - `call`: the source calls the target.
 * - `use`: the source names the target without calling it: takes its value
 *   or address, reads it, writes it.
 * - `relation`: no token spells it: the macro's invocation declared the
 *   target, or the slot holds it.
 */
export type EdgeLine = 'plain' | 'call' | 'use' | 'relation';

export interface EdgeDrawing {
  line: EdgeLine;
  /**
   * Written on the edge; null for an edge that states nothing, and for a
   * plain call, which its line says.
   */
  label: string | null;
}

export interface EdgeLineStyle {
  /** A colour token of `globals.css`. */
  stroke: string;
  /** SVG `stroke-dasharray`; absent for a solid line. */
  dash?: string;
  /** A filled arrowhead, or an open one. */
  arrow: 'closed' | 'open';
}

/**
 * How each line looks.  No two stated lines share both a pattern and an
 * arrowhead, so they are told apart without colour; a call and an unstated
 * reference are both solid arrows and differ in colour alone on the canvas.
 * The legend and the edge menu say which is which.
 */
export const EDGE_LINE_STYLES: Record<EdgeLine, EdgeLineStyle> = {
  plain: { stroke: 'var(--graph-edge-color)', arrow: 'closed' },
  call: { stroke: 'var(--graph-edge-call-color)', arrow: 'closed' },
  use: { stroke: 'var(--graph-edge-use-color)', dash: '7 5', arrow: 'open' },
  relation: { stroke: 'var(--graph-edge-relation-color)', dash: '1 6', arrow: 'open' },
};

/** The words in the order the engine lists them, each with its line. */
const WORDS: ReadonlyArray<{ word: string; line: EdgeLine; mark?: string }> = [
  { word: 'calls', line: 'call' },
  { word: 'writes', line: 'use' },
  { word: 'takes', line: 'use' },
  { word: 'reads', line: 'use' },
  { word: 'declares', line: 'relation', mark: '↦' },
  { word: 'holds', line: 'relation', mark: '⇢' },
];

const REFERS = '→';
const CONTAINS = '▸';

/** The fixed order of the legend: the stated lines, then the unstated one. */
const LEGEND: ReadonlyArray<{ line: EdgeLine; text: string }> = [
  { line: 'call', text: 'calls' },
  { line: 'use', text: 'takes, reads or writes' },
  { line: 'relation', text: '↦ declares, ⇢ holds' },
  { line: 'plain', text: `${REFERS} refers to, nothing more stated` },
];

interface Read {
  /** Known role words, in the engine's order. */
  roles: string[];
  /** Known relation words, in the engine's order, each `mark word`. */
  relations: string[];
  /** Words this file does not know, as they came. */
  unknown: string[];
  /** The line of the first known word; `plain` when there is none. */
  line: EdgeLine;
  /** Some token of the source names the target. */
  refers: boolean;
}

/** The one reading of a statement every function below starts from. */
function read(statement: EdgeStatement): Read {
  const given = statement.kinds ?? [];
  const known = WORDS.filter((entry) => given.includes(entry.word));
  const relations = known.filter((entry) => entry.mark !== undefined);
  return {
    roles: known.filter((entry) => entry.mark === undefined).map((entry) => entry.word),
    relations: relations.map((entry) => `${entry.mark} ${entry.word}`),
    unknown: given.filter(
      (word, at) => !WORDS.some((entry) => entry.word === word) && given.indexOf(word) === at,
    ),
    line: known[0]?.line ?? 'plain',
    // As the report's marks: an edge refers when the engine says a token
    // names the target, and an edge that is no relation at all is a
    // reference whatever it says.
    refers: statement.refers !== false || relations.length === 0,
  };
}

/** How an edge is drawn. */
export function edgeDrawing(statement: EdgeStatement): EdgeDrawing {
  const { roles, relations, unknown, line, refers } = read(statement);
  if (line === 'plain') {
    // Nothing this file knows is stated: the edge as it always was.
    return { line, label: null };
  }
  // A PLAIN CALL CARRIES NO WORD.  On an index that states roles nearly
  // every edge of a call graph is a call and nothing else; the line says
  // it, and a word on each would bury the edges that state more.
  if (roles.length === 1 && roles[0] === 'calls' && unknown.length === 0 && relations.length === 0) {
    return { line, label: null };
  }
  // A relation that is also referred to, with no role to say how, is drawn
  // with both marks, as the report draws `→,⇢`.
  const reference = roles.length > 0 || unknown.length > 0 ? [...roles, ...unknown] : refers ? [REFERS] : [];
  // Roles first, then what this file does not know, then the relations.
  return { line, label: [...reference, ...relations].join(', ') };
}

/**
 * Every relationship of the pair, one per entry, in the report's words:
 * `▸ contains`, `→ refers to: calls, takes`, `↦ declares`, `⇢ holds`.
 */
export function edgeRelationships(
  statement: EdgeStatement,
  also: { contains?: boolean } = {},
): string[] {
  const { roles, relations, unknown, refers } = read(statement);
  const said = [...roles, ...unknown];
  const lines: string[] = [];
  if (also.contains) {
    lines.push(`${CONTAINS} contains`);
  }
  if (refers || said.length > 0) {
    lines.push(said.length > 0 ? `${REFERS} refers to: ${said.join(', ')}` : `${REFERS} refers to`);
  }
  return [...lines, ...relations];
}

/** What one call site does: its words, relations with their marks. */
export function edgeWordsLabel(kinds: ReadonlyArray<string> | undefined): string {
  const { roles, relations, unknown } = read({ kinds });
  return [...roles, ...unknown, ...relations].join(', ');
}

/**
 * What several edges state together: nodes merged by name merge their edges,
 * and the merged edge states what any of them does.
 */
export function unionStatements(edges: ReadonlyArray<EdgeStatement>): Required<EdgeStatement> {
  const given = edges.flatMap((edge) => edge.kinds ?? []);
  const known = WORDS.map((entry) => entry.word).filter((word) => given.includes(word));
  const unknown = given.filter(
    (word, at) => !WORDS.some((entry) => entry.word === word) && given.indexOf(word) === at,
  );
  return {
    kinds: [...known, ...unknown],
    refers: edges.length === 0 || edges.some((edge) => edge.refers !== false),
  };
}

/**
 * The legend of a graph: the lines it draws, in a fixed order.  Empty when
 * no edge states anything, which is every graph of an older index.
 */
export function edgeLegend(
  edges: ReadonlyArray<EdgeStatement>,
): Array<{ line: EdgeLine; text: string }> {
  const drawn = new Set(edges.map((edge) => edgeDrawing(edge).line));
  if (!LEGEND.some((entry) => entry.line !== 'plain' && drawn.has(entry.line))) {
    return [];
  }
  return LEGEND.filter((entry) => drawn.has(entry.line));
}
