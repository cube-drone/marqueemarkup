//! The reference stylesheet, embedded. The canonical file lives at
//! ts/marquee-css/marquee.css (the npm package @cube-drone/marquee-css);
//! this crate carries a byte-identical copy so Rust consumers need no npm -
//! a lockstep test pins the equality, and set-version's lockstep versioning
//! means "same number = same stylesheet".

pub const MARQUEE_CSS: &str = include_str!("../assets/marquee.css");
