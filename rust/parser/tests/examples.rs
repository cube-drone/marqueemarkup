//! The examples corpus is written spec-faithfully: it must parse (parse is
//! total, so that part is trivial) and must contain no invalid_directive
//! nodes. An error node here means either the parser or the example is wrong.

use marquee_parser::Node;
use std::fs;
use std::path::PathBuf;

fn collect_invalid(node: &Node, path: &str, out: &mut Vec<String>) {
    let children = match node {
        Node::Document { children, .. }
        | Node::Paragraph { children }
        | Node::Heading { children, .. }
        | Node::Blockquote { children }
        | Node::List { children, .. }
        | Node::ListItem { children }
        | Node::Directive { children, .. }
        | Node::Emphasis { children }
        | Node::Strong { children }
        | Node::Strikethrough { children }
        | Node::Link { children, .. }
        | Node::Span { children, .. } => children,
        Node::InvalidDirective { reason, .. } => {
            out.push(format!("{path}: invalid_directive ({reason:?})"));
            return;
        }
        _ => return,
    };
    for child in children {
        collect_invalid(child, path, out);
    }
}

#[test]
fn examples_parse_clean() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples");
    let mut found_any = false;
    let mut problems: Vec<String> = Vec::new();
    for entry in fs::read_dir(&dir).expect("examples/ directory") {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|x| x != "mq") {
            continue;
        }
        found_any = true;
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let source = fs::read_to_string(&path).unwrap();
        match marquee_parser::parse(&source) {
            Err(e) => problems.push(format!("{name}: {e}")),
            Ok(doc) => collect_invalid(&doc, &name, &mut problems),
        }
    }
    assert!(found_any, "no .mq files found in {}", dir.display());
    assert!(problems.is_empty(), "examples did not parse clean:\n{}", problems.join("\n"));
}
