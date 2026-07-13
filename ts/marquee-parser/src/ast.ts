// The AST is the contract: these shapes mirror SPEC.md's node inventory
// exactly, and structural equality against the vectors is conformance.

export type Attrs = Record<string, string>;

/** The closed `invalid_directive` reason enum (SPEC.md, "The AST"). */
export type Reason =
  | "bad_name"
  | "bad_attribute"
  | "attribute_too_long"
  | "depth_exceeded"
  | "mismatched_close"
  | "stray_close";

export type Node =
  // Blocks
  | { type: "document"; version: number; children: Node[] }
  | { type: "paragraph"; children: Node[] }
  | { type: "heading"; level: number; children: Node[] }
  | { type: "code_block"; info?: string; text: string }
  | { type: "blockquote"; children: Node[] }
  | { type: "list"; ordered: boolean; children: Node[] }
  | { type: "list_item"; children: Node[] }
  | { type: "thematic_break" }
  | { type: "directive"; name: string; attrs: Attrs; children: Node[] }
  | { type: "invalid_directive"; reason: Reason; children: Node[] }
  | { type: "comment"; text: string }
  // Inlines
  | { type: "text"; value: string }
  | { type: "emphasis"; children: Node[] }
  | { type: "strong"; children: Node[] }
  | { type: "strikethrough"; children: Node[] }
  | { type: "code_span"; text: string }
  | { type: "link"; target: string; children: Node[] }
  | { type: "embed"; target: string; alt: string }
  | { type: "turbolink"; target: string }
  | { type: "span"; name: string; attrs: Attrs; children: Node[] }
  | { type: "emoji"; slug: string }
  | { type: "hard_break" };
