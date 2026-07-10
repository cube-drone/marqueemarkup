//! Bless tool: parse `.mq` files and emit a candidate vector file (a JSON
//! array of {name, marquee, ast}) on stdout. Per vectors/README.md this is
//! the growth mechanism for the corpus: a human reviews the output against
//! intent before committing it.
//!
//! Usage: cargo run --bin bless -- ../../examples/*.mq > ../../vectors/examples.json

use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let mut paths: Vec<String> = env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: bless <file.mq>...");
        std::process::exit(2);
    }
    paths.sort();
    let mut cases = Vec::new();
    for path in &paths {
        let source = fs::read_to_string(path).unwrap_or_else(|e| {
            eprintln!("{path}: {e}");
            std::process::exit(1);
        });
        // The vector's `marquee` field is the input after front-door
        // normalization (\n line endings only).
        let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
        let doc = marquee_parser::parse(&normalized).unwrap_or_else(|e| {
            eprintln!("{path}: {e}");
            std::process::exit(1);
        });
        let p = Path::new(path);
        let stem = p.file_stem().unwrap().to_string_lossy();
        let group = p
            .parent()
            .and_then(|d| d.file_name())
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "vectors".to_string());
        cases.push(serde_json::json!({
            "name": format!("{group}/{stem}"),
            "marquee": normalized,
            "ast": serde_json::to_value(&doc).unwrap(),
        }));
    }
    println!("{}", serde_json::to_string_pretty(&cases).unwrap());
}
