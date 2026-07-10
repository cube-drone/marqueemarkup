//! The AST is the contract: node shapes here mirror SPEC.md's node inventory
//! exactly, and the serde serialization *is* the vector serialization.

use serde::Serialize;
use std::collections::BTreeMap;

pub type Attrs = BTreeMap<String, String>;

/// The closed `invalid_directive` reason enum (SPEC.md, "The AST").
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    BadName,
    BadAttribute,
    AttributeTooLong,
    DepthExceeded,
    MismatchedClose,
    StrayClose,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Node {
    // Blocks
    Document {
        version: u64,
        children: Vec<Node>,
    },
    Paragraph {
        children: Vec<Node>,
    },
    Heading {
        level: u8,
        children: Vec<Node>,
    },
    CodeBlock {
        #[serde(skip_serializing_if = "Option::is_none")]
        info: Option<String>,
        text: String,
    },
    Blockquote {
        children: Vec<Node>,
    },
    List {
        ordered: bool,
        children: Vec<Node>,
    },
    ListItem {
        children: Vec<Node>,
    },
    ThematicBreak,
    Directive {
        name: String,
        attrs: Attrs,
        children: Vec<Node>,
    },
    InvalidDirective {
        reason: Reason,
        children: Vec<Node>,
    },
    Comment {
        text: String,
    },
    // Inlines
    Text {
        value: String,
    },
    Emphasis {
        children: Vec<Node>,
    },
    Strong {
        children: Vec<Node>,
    },
    Strikethrough {
        children: Vec<Node>,
    },
    CodeSpan {
        text: String,
    },
    Link {
        target: String,
        children: Vec<Node>,
    },
    Embed {
        target: String,
        alt: String,
    },
    Turbolink {
        target: String,
    },
    Span {
        name: String,
        attrs: Attrs,
        children: Vec<Node>,
    },
    Emoji {
        slug: String,
    },
    HardBreak,
}
