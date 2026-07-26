//! mq2md <file.mq> — convert Marquee to Markdown on stdout.
use std::io::Read;
fn main() {
    let arg = std::env::args().nth(1);
    let src = match arg {
        Some(p) => std::fs::read_to_string(&p).expect("read file"),
        None => { let mut s = String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); s }
    };
    match marquee_markdown::to_markdown(&src) {
        Ok(md) => print!("{md}"),
        Err(e) => { eprintln!("error: {e}"); std::process::exit(1); }
    }
}
