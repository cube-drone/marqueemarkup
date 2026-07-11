//! Self-goldens: this renderer's output pinned against its own past.
//! Catches unintended rendering changes; intentional ones re-bless
//! (cargo run --bin bless).

use marquee_html_renderer::{render, BareWebProfile};
use marquee_parser::parse;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[test]
fn goldens() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let goldens: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(root.join("goldens.json")).expect(
            "goldens.json missing - run: cargo run --bin bless",
        ))
        .unwrap();
    let goldens: BTreeMap<String, String> = goldens
        .as_array()
        .unwrap()
        .iter()
        .map(|g| {
            (
                g["name"].as_str().unwrap().to_string(),
                g["html"].as_str().unwrap().to_string(),
            )
        })
        .collect();

    let dir = root.join("../../vectors");
    let mut failures = Vec::new();
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    for path in files {
        let cases: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        for case in cases.as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let source = case["marquee"].as_str().unwrap();
            let html = render(&parse(source).unwrap(), &BareWebProfile);
            match goldens.get(name) {
                None => failures.push(format!("{name}: no golden - run: cargo run --bin bless")),
                Some(golden) if golden != &html => {
                    failures.push(format!("{name}:\n  golden: {golden}\n  actual: {html}"))
                }
                _ => {}
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
