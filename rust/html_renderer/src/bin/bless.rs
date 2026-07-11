//! Regenerate this renderer's self-goldens: render every vector case and
//! record the HTML. These police *this renderer's yesterday* (regression),
//! not the TypeScript renderer's bytes - renderers may differ, per spec.
//!
//!     cargo run --bin bless > goldens.json   (from rust/html_renderer/)

use marquee_html_renderer::{render, BareWebProfile};
use marquee_parser::parse;
use std::fs;
use std::path::PathBuf;

fn main() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vectors");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("vectors/")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();

    let mut out = Vec::new();
    for path in files {
        let cases: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        for case in cases.as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let source = case["marquee"].as_str().unwrap();
            let html = render(&parse(source).unwrap(), &BareWebProfile);
            out.push(serde_json::json!({ "name": name, "html": html }));
        }
    }
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("goldens.json");
    fs::write(&path, format!("{}\n", serde_json::to_string_pretty(&out).unwrap())).unwrap();
    eprintln!("blessed {} goldens -> {}", out.len(), path.display());
}
