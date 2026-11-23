import { describe, expect, it } from 'vitest';
import {
  EDGE_LINE_STYLES,
  edgeDrawing,
  edgeLegend,
  edgeRelationships,
  edgeWordsLabel,
  unionStatements,
} from './edge_kinds';

describe('edgeDrawing: the line is drawn for the first word, the label says all of them', () => {
  it('draws an edge that states nothing exactly as before: plain, no label', () => {
    expect(edgeDrawing({})).toEqual({ line: 'plain', label: null });
    expect(edgeDrawing({ kinds: [] })).toEqual({ line: 'plain', label: null });
    expect(edgeDrawing({ kinds: undefined, refers: true })).toEqual({ line: 'plain', label: null });
  });

  it('draws each role word', () => {
    // A plain call says so with its line alone: on an index that states
    // roles nearly every edge of a call graph is one, and a word on each
    // would be noise.
    expect(edgeDrawing({ kinds: ['calls'] })).toEqual({ line: 'call', label: null });
    expect(edgeDrawing({ kinds: ['writes'] })).toEqual({ line: 'use', label: 'writes' });
    expect(edgeDrawing({ kinds: ['takes'] })).toEqual({ line: 'use', label: 'takes' });
    expect(edgeDrawing({ kinds: ['reads'] })).toEqual({ line: 'use', label: 'reads' });
  });

  it('draws a relation with its mark, and without `→` when no token names the target', () => {
    expect(edgeDrawing({ kinds: ['holds'], refers: false })).toEqual({
      line: 'relation',
      label: '⇢ holds',
    });
    expect(edgeDrawing({ kinds: ['declares'], refers: false })).toEqual({
      line: 'relation',
      label: '↦ declares',
    });
  });

  it('says every word of a pair: the frontend does not choose', () => {
    // A call and a callback registration between the same two functions.
    expect(edgeDrawing({ kinds: ['calls', 'takes'] })).toEqual({
      line: 'call',
      label: 'calls, takes',
    });
    // `n++`: written and read.
    expect(edgeDrawing({ kinds: ['writes', 'reads'] })).toEqual({
      line: 'use',
      label: 'writes, reads',
    });
    // A macro whose body also names what its invocation declared.
    expect(edgeDrawing({ kinds: ['takes', 'declares'] })).toEqual({
      line: 'use',
      label: 'takes, ↦ declares',
    });
    // A slot that holds a function a token of it also names, role unstated:
    // the pair refers AND holds, as the report draws `→,⇢`.
    expect(edgeDrawing({ kinds: ['holds'], refers: true })).toEqual({
      line: 'relation',
      label: '→, ⇢ holds',
    });
    expect(edgeDrawing({ kinds: ['holds'] })).toEqual({
      line: 'relation',
      label: '→, ⇢ holds',
    });
  });

  it('orders the words as the engine lists them, whatever order they arrive in', () => {
    expect(edgeDrawing({ kinds: ['holds', 'takes', 'calls'] })).toEqual({
      line: 'call',
      label: 'calls, takes, ⇢ holds',
    });
  });

  it('is total: a word it does not know changes nothing about the line', () => {
    // Only unknown words: drawn exactly as an edge that states nothing.
    expect(edgeDrawing({ kinds: ['frobnicates'] })).toEqual({ line: 'plain', label: null });
    // Beside a known word it is still said.
    expect(edgeDrawing({ kinds: ['frobnicates', 'takes'] })).toEqual({
      line: 'use',
      label: 'takes, frobnicates',
    });
  });
});

describe('edgeRelationships: every relationship of the pair, in the report\'s words', () => {
  it('an edge that states nothing refers to its target', () => {
    expect(edgeRelationships({})).toEqual(['→ refers to']);
  });

  it('lists the roles after the reference they narrow', () => {
    expect(edgeRelationships({ kinds: ['calls'] })).toEqual(['→ refers to: calls']);
    expect(edgeRelationships({ kinds: ['calls', 'takes'] })).toEqual(['→ refers to: calls, takes']);
  });

  it('lists a relation on its own line, with `→` only when a token names the target', () => {
    expect(edgeRelationships({ kinds: ['holds'], refers: false })).toEqual(['⇢ holds']);
    expect(edgeRelationships({ kinds: ['holds'] })).toEqual(['→ refers to', '⇢ holds']);
    expect(edgeRelationships({ kinds: ['takes', 'declares', 'holds'] })).toEqual([
      '→ refers to: takes',
      '↦ declares',
      '⇢ holds',
    ]);
  });

  it('a pair that also contains says so first', () => {
    expect(edgeRelationships({ kinds: ['calls'] }, { contains: true })).toEqual([
      '▸ contains',
      '→ refers to: calls',
    ]);
  });

  it('keeps a word it does not know', () => {
    expect(edgeRelationships({ kinds: ['frobnicates'] })).toEqual(['→ refers to: frobnicates']);
  });
});

describe('edgeWordsLabel: what one call site does', () => {
  it('is empty when nothing is stated', () => {
    expect(edgeWordsLabel(undefined)).toBe('');
    expect(edgeWordsLabel([])).toBe('');
  });

  it('joins the words, relations with their marks', () => {
    expect(edgeWordsLabel(['writes', 'reads'])).toBe('writes, reads');
    expect(edgeWordsLabel(['holds'])).toBe('⇢ holds');
  });
});

describe('unionStatements: nodes merged by name merge what their edges state', () => {
  it('unions the words and refers when any does', () => {
    expect(
      unionStatements([
        { kinds: ['takes'] },
        { kinds: ['calls'] },
        { kinds: ['holds'], refers: false },
      ]),
    ).toEqual({ kinds: ['calls', 'takes', 'holds'], refers: true });
  });

  it('stays a relation alone when every edge is one', () => {
    expect(
      unionStatements([
        { kinds: ['holds'], refers: false },
        { kinds: ['holds'], refers: false },
      ]),
    ).toEqual({ kinds: ['holds'], refers: false });
  });

  it('states nothing when no edge does', () => {
    expect(unionStatements([{}, { kinds: [] }])).toEqual({ kinds: [], refers: true });
    expect(unionStatements([])).toEqual({ kinds: [], refers: true });
  });
});

describe('the four lines are told apart without colour', () => {
  it('each line has its own pattern or arrowhead', () => {
    const shape = (line: keyof typeof EDGE_LINE_STYLES) =>
      `${EDGE_LINE_STYLES[line].dash ?? 'solid'}/${EDGE_LINE_STYLES[line].arrow}`;
    // A call and an unstated reference are both solid arrows and neither
    // carries a word: the colour, the legend and the edge menu tell them
    // apart.  The other two differ in the line itself.
    expect(shape('plain')).toBe(shape('call'));
    expect(new Set([shape('call'), shape('use'), shape('relation')]).size).toBe(3);
    expect(EDGE_LINE_STYLES.call.stroke).not.toBe(EDGE_LINE_STYLES.plain.stroke);
    expect(edgeDrawing({}).label).toBeNull();
    // A call that is anything more says all of it.
    expect(edgeDrawing({ kinds: ['calls', 'reads'] }).label).toBe('calls, reads');
    expect(edgeDrawing({ kinds: ['calls', 'holds'] }).label).toBe('calls, ⇢ holds');
    expect(edgeDrawing({ kinds: ['calls', 'frobs'] }).label).toBe('calls, frobs');
  });

  it('the plain line is the edge as it was drawn before any edge stated anything', () => {
    expect(EDGE_LINE_STYLES.plain).toEqual({
      stroke: 'var(--graph-edge-color)',
      arrow: 'closed',
    });
  });
});

describe('edgeLegend', () => {
  it('is empty when no edge states anything', () => {
    expect(edgeLegend([{}, { kinds: [] }])).toEqual([]);
  });

  it('names the lines the graph draws, in a fixed order, in the report\'s words', () => {
    const legend = edgeLegend([
      { kinds: ['holds'], refers: false },
      { kinds: ['calls'] },
      {},
      { kinds: ['writes'] },
    ]);
    expect(legend.map((entry) => entry.line)).toEqual(['call', 'use', 'relation', 'plain']);
    expect(legend.map((entry) => entry.text)).toEqual([
      'calls',
      'takes, reads or writes',
      '↦ declares, ⇢ holds',
      '→ refers to, nothing more stated',
    ]);
  });

  it('leaves out a line no edge has', () => {
    expect(edgeLegend([{ kinds: ['calls'] }]).map((entry) => entry.line)).toEqual(['call']);
  });
});
