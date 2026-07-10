//! Conformance runner: every {name, marquee, ast} case in ../../vectors/*.json
//! must parse to structural equality. This same corpus, unchanged, is what
//! the TypeScript implementation will be held to.

use std::fs;
use std::path::PathBuf;

#[test]
fn conformance_vectors() {
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
            let input = case["marquee"].as_str().expect("case marquee");
            let expected = &case["ast"];
            match marquee_parser::parse(input) {
                Err(e) => failures.push(format!("{name}: parse error: {e}")),
                Ok(doc) => {
                    let actual = serde_json::to_value(&doc).unwrap();
                    if &actual != expected {
                        failures.push(format!(
                            "{name}:\n  expected: {expected}\n  actual:   {actual}"
                        ));
                    }
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} vector cases failed:\n{}",
        failures.len(),
        total,
        failures.join("\n")
    );
}
