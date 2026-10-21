//! Denial-of-service regressions: author documents arrive untrusted and are
//! re-parsed per keystroke, so no input may cost more than linear time. Each
//! shape here was quadratic (seconds at 100k chars) before the bracket
//! matches were precomputed. The bound is generous on purpose - these parse
//! in milliseconds now, even in a debug build; the old code blew it by an
//! order of magnitude. Mirror of ts/marquee-parser/test/complexity.test.ts
//! (whose whitespace shapes Rust's trim_end_matches never suffered, but
//! which ride along here so the two lists stay one list).

use std::time::{Duration, Instant};

const N: usize = 100_000;
const BOUND: Duration = Duration::from_secs(1);

fn rep(s: &str, chars: usize) -> String {
    s.repeat(chars / s.len())
}

fn shapes() -> Vec<(&'static str, String)> {
    vec![
        // Every `[` used to scan forward to its balanced `]`.
        ("unclosed brackets", rep("[", N)),
        ("nested brackets", rep("[", N / 2) + &rep("]", N / 2)),
        ("unclosed embeds", rep("![", N)),
        ("unclosed closers", rep("[/", N / 2) + &rep("]", N / 2)),
        ("unclosed span openers", rep("[b x=\"", N)),
        ("nested links", rep("[", N / 8) + "a" + &rep("](x)", N / 2)),
        // Every `](` used to lex its target to the end of the container.
        ("unclosed link targets", rep("[a](", N)),
        // Nested openers each re-parsed every attribute list inside them,
        // until the opener cap (MAX_SPAN_OPENER_BYTES) bounded the interior.
        ("nested bare-value openers", rep("[a=", N / 2) + &rep("]", N / 4)),
        ("nested openers, one late quote", rep("[b a=", N / 2) + "\"" + &rep("]", N / 6)),
        ("nested quoted openers", rep("[b a=\"", N / 2) + &rep("\"]", N / 3)),
        // /[ \t]+$/ retried from every start position in a space run (TS).
        ("paragraph trailing space", "a".to_string() + &rep(" ", N) + "b"),
        ("thematic break trailing space", "---".to_string() + &rep(" ", N) + "b"),
        ("fence close trailing space", "```\n```".to_string() + &rep(" ", N) + "b"),
        ("fence info inner space", "```a".to_string() + &rep(" ", N) + "b"),
        ("directive trailing space", ":::x".to_string() + &rep(" ", N) + "b"),
        ("list item trailing space", "- a".to_string() + &rep(" ", N) + "b"),
    ]
}

#[test]
fn adversarial_inputs_parse_in_linear_time() {
    let mut failures: Vec<String> = Vec::new();
    for (name, input) in shapes() {
        let start = Instant::now();
        marquee_parser::parse(&input).unwrap();
        let elapsed = start.elapsed();
        if elapsed >= BOUND {
            failures.push(format!("{name}: {elapsed:?} for {} chars", input.len()));
        }
    }
    assert!(failures.is_empty(), "too slow:\n{}", failures.join("\n"));
}
