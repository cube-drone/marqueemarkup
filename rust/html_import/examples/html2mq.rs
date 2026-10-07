//! html2mq [--base URL] [file.html] — convert HTML to Marquee on stdout; the
//! loss summary goes to stderr.
use marquee_html_import::{to_marquee_with, OnLoss, Options};
use std::io::Read;
fn main() {
    let mut args = std::env::args().skip(1);
    let mut options = Options { on_loss: OnLoss::Stderr, ..Default::default() };
    let mut path = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--base" => options.base_url = args.next(),
            _ => path = Some(arg),
        }
    }
    let src = match path {
        Some(p) => std::fs::read_to_string(&p).expect("read file"),
        None => { let mut s = String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); s }
    };
    print!("{}", to_marquee_with(&src, &options));
}
