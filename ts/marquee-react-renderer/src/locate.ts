// Finding the node an editor's cursor is "in" - which is not as simple as
// containment, because containment has holes.
//
// A span covers a construct's source extent, and the gaps BETWEEN
// constructs (the blank line between two paragraphs, the newline between
// two list items) belong to no child at all - only to the container. So a
// cursor parked in a gap is, strictly, "inside" nothing smaller than the
// container: strict containment answers `document` for a cursor on a blank
// line, and scrolling to *that* means scrolling to the middle of the whole
// document. Correct, and useless.
//
// `nodeNear` is the editor-shaped answer: descend toward the nearest child
// at every level, so a cursor in the gap between two paragraphs finds the
// paragraph beside it rather than the container above it.

import type { Node, Span } from "@cube-drone/marquee-parser";

function childrenOf(node: Node): readonly Node[] {
  return "children" in node ? node.children : [];
}

/** The deepest node whose span CONTAINS this offset. Exact, with holes: a
 * cursor in the whitespace between blocks lands on their container. */
export function nodeAt(doc: Node, spans: WeakMap<Node, Span>, offset: number): Node | null {
  const root = spans.get(doc);
  if (root === undefined || offset < root.start || offset > root.end) {
    return null;
  }
  let node = doc;
  for (;;) {
    const child = childrenOf(node).find((c) => {
      const span = spans.get(c);
      return span !== undefined && offset >= span.start && offset <= span.end;
    });
    if (child === undefined) {
      return node;
    }
    node = child;
  }
}

/** The deepest node AT or NEAREST this offset. Where a child contains the
 * offset this agrees with `nodeAt`; where none does (a gap), it descends
 * into the closest child by source distance instead of stopping at the
 * container. Ties go to the earlier node. This is what an editor wants. */
export function nodeNear(doc: Node, spans: WeakMap<Node, Span>, offset: number): Node | null {
  if (spans.get(doc) === undefined) {
    return null;
  }
  let node = doc;
  for (;;) {
    const kids = childrenOf(node);
    let chosen: Node | null = null;
    let best = Infinity;
    for (const child of kids) {
      const span = spans.get(child);
      if (span === undefined) {
        continue;
      }
      if (offset >= span.start && offset <= span.end) {
        chosen = child;
        best = -1;
        break; // containment always wins over proximity
      }
      const distance = offset < span.start ? span.start - offset : offset - span.end;
      if (distance < best) {
        best = distance;
        chosen = child;
      }
    }
    if (chosen === null) {
      return node; // a leaf, or a container whose children carry no spans
    }
    node = chosen;
  }
}
