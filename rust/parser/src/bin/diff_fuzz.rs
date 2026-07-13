//! Differential fuzzer: generate documents, parse with both reference
//! implementations, and demand identical ASTs. "One input, one parse,
//! everywhere" as an executable property.
//!
//! Usage:
//!     cargo run --release --bin diff_fuzz -- [--n 20000] [--seed 0] [--batch 2000]
//!
//! The Rust side parses in-process; the TypeScript side runs via
//! ts/marquee-parser/scripts/ast.ts, so `node` must be on PATH. Exit code 0 = no
//! divergence. On divergence, prints a minimized repro and writes the full
//! input to target/diff_fuzz_failure.mq.

use std::io::Write as _;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Grammar-shaped shrapnel: biased toward the characters where the two
/// implementations could plausibly disagree.
const FRAGMENTS: &[&str] = &[
    // inline machinery
    "*", "**", "***", "~~", "~", "\\", "`", "``", "```", "[", "]", "(", ")",
    "[blink]", "[/blink]", "[color=red]", "[/color]", "[x](t)", "![a](b)",
    ":", "::", ":smile:", ":no", "=", "\"", "\\\"", "[/", "![",
    // block machinery
    ":::", "::: ", ":::x", ":::x:::", ":::x k=v", "::: x", "\n:::\n",
    "%%", "%% raw", "# ", "## h", "#x", "> ", ">> ", "- ", "* ", "+ ", "1. ",
    "12. ", "---", "----", "#!marquee 0\n", "#!marquee 2\n",
    "#!marquee 99999999999999999999\n",
    // targets / turbolinks
    "https://e.x/", "a://b", "Note:this", "blob:h", "../up", "k=\":::\"",
    // text, whitespace, unicode
    "a", "b", "word", " ", "  ", "\t", "\n", "\n\n", "\u{00a0}", "é", "𝄞",
    "中", "\u{200b}", "…",
];

/// splitmix64: tiny, deterministic, dependency-free. Seeds are not
/// compatible with the retired python driver's.
struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }

    fn fragment(&mut self) -> &'static str {
        FRAGMENTS[self.below(FRAGMENTS.len())]
    }
}

fn manifest_relative(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel)
}

fn load_corpus() -> Vec<String> {
    let dir = manifest_relative("../../vectors");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("vectors/ directory")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    let mut corpus = Vec::new();
    for path in files {
        let cases: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        for case in cases.as_array().unwrap() {
            corpus.push(case["marquee"].as_str().unwrap().to_string());
        }
    }
    corpus
}

fn gen_doc(rng: &mut Rng, corpus: &[String]) -> String {
    match rng.below(100) {
        // fragment soup
        0..=44 => {
            let n = 1 + rng.below(60);
            (0..n).map(|_| rng.fragment()).collect()
        }
        // line soup
        45..=74 => {
            let lines: Vec<String> = (0..1 + rng.below(20))
                .map(|_| (0..rng.below(9)).map(|_| rng.fragment()).collect())
                .collect();
            let mut doc = lines.join("\n");
            if rng.below(2) == 0 {
                doc.push('\n');
            }
            doc
        }
        // corpus mutation
        _ => {
            let base = &corpus[rng.below(corpus.len())];
            let mut pieces: Vec<String> = base.chars().map(String::from).collect();
            for _ in 0..1 + rng.below(8) {
                if pieces.is_empty() {
                    break;
                }
                let i = rng.below(pieces.len());
                match rng.below(3) {
                    0 => {
                        pieces.remove(i);
                    }
                    1 => pieces.insert(i, rng.fragment().to_string()),
                    _ => pieces[i] = rng.fragment().to_string(),
                }
            }
            pieces.concat()
        }
    }
}

/// One side's verdict on one document, in the shared parity shape.
fn rust_result(doc: &str) -> serde_json::Value {
    match std::panic::catch_unwind(|| marquee_parser::parse(doc)) {
        Ok(Ok(ast)) => serde_json::json!({ "ast": ast }),
        Ok(Err(e)) => serde_json::json!({ "error": e.to_string() }),
        Err(_) => serde_json::json!({ "panic": true }),
    }
}

fn ts_results(inputs: &[String]) -> Vec<serde_json::Value> {
    let script = manifest_relative("../../ts/marquee-parser/scripts/ast.ts");
    let mut child = Command::new("node")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn node (is it on PATH?)");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(inputs).unwrap().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "node harness died");
    serde_json::from_slice(&output.stdout).expect("node harness output")
}

fn diverges(doc: &str) -> bool {
    rust_result(doc) != ts_results(std::slice::from_ref(&doc.to_string()))[0]
}

/// Greedy line-drop, then char-drop, keeping the divergence alive.
fn minimize(mut doc: String) -> String {
    let mut lines: Vec<&str> = doc.split('\n').collect();
    let mut i = 0;
    while i < lines.len() && lines.len() > 1 {
        let mut trial = lines.clone();
        trial.remove(i);
        if diverges(&trial.join("\n")) {
            lines = trial;
        } else {
            i += 1;
        }
    }
    doc = lines.join("\n");
    let mut i = 0;
    while i < doc.chars().count() {
        let trial: String = doc
            .chars()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, c)| c)
            .collect();
        if !trial.is_empty() && diverges(&trial) {
            doc = trial;
        } else {
            i += 1;
        }
    }
    doc
}

fn main() {
    std::panic::set_hook(Box::new(|_| {})); // panics are data here

    let mut n = 20_000usize;
    let mut seed = 0u64;
    let mut batch_size = 2_000usize;
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let mut value = || it.next().expect("flag needs a value").parse().unwrap();
        match arg.as_str() {
            "--n" => n = value() as usize,
            "--seed" => seed = value(),
            "--batch" => batch_size = value() as usize,
            other => panic!("unknown flag {other}"),
        }
    }

    let corpus = load_corpus();
    let mut rng = Rng(seed);
    let mut tested = 0usize;

    while tested < n {
        let batch: Vec<String> = (0..batch_size.min(n - tested))
            .map(|_| gen_doc(&mut rng, &corpus))
            .collect();
        let ts = ts_results(&batch);
        for (doc, ts_result) in batch.iter().zip(&ts) {
            if &rust_result(doc) != ts_result {
                let small = minimize(doc.clone());
                let failure_path = manifest_relative("target/diff_fuzz_failure.mq");
                std::fs::write(&failure_path, doc).unwrap();
                println!("DIVERGENCE (minimized):");
                println!("  input: {small:?}");
                println!("  rust:  {}", rust_result(&small));
                println!("  ts:    {}", ts_results(std::slice::from_ref(&small))[0]);
                println!("full input saved to {}", failure_path.display());
                std::process::exit(1);
            }
        }
        tested += batch.len();
        println!("  {tested}/{n} tested, 0 divergences");
    }
    println!("OK: {tested} documents, zero divergence (seed {seed})");
}
