//! The serializer's contract, proven against the conformance corpus: for every
//! parser-produced AST, `parse(serialize(ast)) == ast`. Marquee guarantees one
//! AST per source, never one source per AST, so we compare TREES, not bytes -
//! the serializer picks a canonical spelling and the round trip must land on
//! the same tree. The vectors' `ast` field is the ground truth (already the
//! output of `parse(marquee)`), so re-parsing our re-emission must match it.

use std::fs;
use std::path::PathBuf;

#[test]
fn serialize_round_trips_every_vector() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vectors");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("vectors/ directory")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no vector files found in {}", dir.display());

    let mut total = 0usize;
    let mut failures: Vec<String> = Vec::new();
    for path in files {
        let raw = fs::read_to_string(&path).unwrap();
        let cases: serde_json::Value = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("{}: invalid JSON: {e}", path.display()));
        for case in cases.as_array().expect("vector file must be a JSON array") {
            total += 1;
            let name = case["name"].as_str().expect("case name");
            let expected = &case["ast"];
            // Start from the input so the first parse is real, then serialize
            // that tree and re-parse: the second tree must equal the vector AST.
            let input = case["marquee"].as_str().expect("case marquee");
            let doc = match marquee_parser::parse(input) {
                Ok(d) => d,
                Err(e) => {
                    failures.push(format!("{name}: initial parse error: {e}"));
                    continue;
                }
            };
            let source = marquee_parser::serialize(&doc);
            match marquee_parser::parse(&source) {
                Err(e) => failures.push(format!("{name}: reparse error: {e}\n  emitted: {source:?}")),
                Ok(reparsed) => {
                    let actual = serde_json::to_value(&reparsed).unwrap();
                    if &actual != expected {
                        failures.push(format!(
                            "{name}:\n  emitted:  {source:?}\n  expected: {expected}\n  actual:   {actual}"
                        ));
                    }
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} round-trip cases failed:\n{}",
        failures.len(),
        total,
        failures.join("\n\n")
    );
}
