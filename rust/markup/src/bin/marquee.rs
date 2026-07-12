//! The marquee CLI, Rust spelling - flag-for-flag with the npm one:
//!
//!     marquee hello.mq > hello.html      a self-contained page on stdout
//!     marquee hello.mq -o hello.html     or written to a file
//!     marquee site/ dist/                a whole site
//!
//! Batteries included, no surprises: by default the CLI runs the turbolink
//! fetch-ahead pass (OpenGraph summaries for bare web links). --nofetch
//! produces the spartan, zero-network output instead.

use marquee_markup::{
    build_site, build_site_fetch, marquee, marquee_fetch, ColorScheme, MarqueeOptions,
    SiteOptions,
};
use std::path::Path;
use std::process::exit;

fn usage() -> ! {
    eprintln!(
        "usage:
  marquee <file.mq> [-o out.html]   render one self-contained page
  marquee <site-dir> <out-dir>      build a whole site
  --nofetch                         skip the fetch-ahead pass (no network,
                                    web turbolinks stay plain links)
  --envelope                        wrap plain documents in a 650px centered
                                    envelope for readability (documents with
                                    their own :::page layout are left alone)
  --darkmode                        force dark mode (default: follow the
                                    reader's OS theme)
  --noreadable                      don't rescue author colors (default: their
                                    lightness is clamped toward the canvas's
                                    opposite so colored text stays legible)"
    );
    exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut positional: Vec<String> = Vec::new();
    let mut out_file: Option<String> = None;
    let mut fetch_mode = true;
    let mut envelope = false;
    let mut readable: Option<bool> = None;
    let mut color_scheme: Option<ColorScheme> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-o" => {
                i += 1;
                out_file = Some(args.get(i).cloned().unwrap_or_else(|| usage()));
            }
            "--nofetch" => fetch_mode = false,
            "--envelope" => envelope = true,
            "--darkmode" => color_scheme = Some(ColorScheme::Dark),
            "--noreadable" => readable = Some(false),
            other => positional.push(other.to_string()),
        }
        i += 1;
    }
    if positional.is_empty() || positional.len() > 2 {
        usage();
    }
    let input = Path::new(&positional[0]);
    if !input.exists() {
        eprintln!("marquee: {}: not found", positional[0]);
        exit(1);
    }

    if input.is_dir() {
        let Some(out_dir) = positional.get(1) else { usage() };
        let opts = SiteOptions {
            envelope,
            readable,
            color_scheme,
            ..SiteOptions::default()
        };
        let result = if fetch_mode {
            build_site_fetch(input, Path::new(out_dir), &opts)
        } else {
            build_site(input, Path::new(out_dir), &opts)
        };
        match result {
            Ok(report) => eprintln!(
                "built {} pages ({}) + {} media files + {} font faces -> {}",
                report.pages.len(),
                report.pages.join(", "),
                report.media_files,
                report.font_faces.len(),
                report.out_dir.display()
            ),
            Err(e) => {
                eprintln!("marquee: {e}");
                exit(1);
            }
        }
    } else {
        if positional.len() != 1 {
            usage();
        }
        let source = match std::fs::read_to_string(input) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("marquee: {}: {e}", positional[0]);
                exit(1);
            }
        };
        let opts = MarqueeOptions {
            envelope,
            readable,
            color_scheme,
            ..MarqueeOptions::default()
        };
        let page = if fetch_mode {
            marquee_fetch(&source, &opts)
        } else {
            marquee(&source, &opts)
        };
        match (page, out_file) {
            (Ok(page), None) => print!("{page}"),
            (Ok(page), Some(path)) => match std::fs::write(&path, page) {
                Ok(()) => eprintln!("wrote {path}"),
                Err(e) => {
                    eprintln!("marquee: {path}: {e}");
                    exit(1);
                }
            },
            (Err(e), _) => {
                eprintln!("marquee: {e}");
                exit(1);
            }
        }
    }
}
