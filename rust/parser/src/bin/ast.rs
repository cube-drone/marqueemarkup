//! Differential-fuzzing parity CLI: read a JSON array of Marquee inputs on
//! stdin, emit a JSON array of results on stdout - {"ast": ...} for a parse,
//! {"error": "..."} for a version refusal, {"panic": true} if the parser
//! blew up (which is itself a conformance failure: parse is total).

use std::io::Read;

fn main() {
    // Panics are data here, not crashes; keep stderr quiet.
    std::panic::set_hook(Box::new(|_| {}));

    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let inputs: Vec<String> = serde_json::from_str(&input).expect("stdin: JSON array of strings");

    let results: Vec<serde_json::Value> = inputs
        .iter()
        .map(|doc| {
            match std::panic::catch_unwind(|| marquee_parser::parse(doc)) {
                Ok(Ok(ast)) => serde_json::json!({ "ast": ast }),
                Ok(Err(e)) => serde_json::json!({ "error": e.to_string() }),
                Err(_) => serde_json::json!({ "panic": true }),
            }
        })
        .collect();
    println!("{}", serde_json::to_string(&results).unwrap());
}
