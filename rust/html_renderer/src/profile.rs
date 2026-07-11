//! Embedder profiles: the language defines meaning, the embedder defines
//! policy. Every render-time capability decision routes through here; the
//! renderer itself never fetches, never guesses trust, never widens a
//! scheme allowlist. Rust spelling of ts/html_renderer's Profile: a trait
//! whose default methods ARE the bare-web profile.

use marquee_parser::Attrs;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Image,
    Audio,
    Video,
}

#[derive(Debug, Clone)]
pub struct MediaResolution {
    pub kind: MediaKind,
    pub url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurbolinkLevel {
    Full,
    Title,
    Bare,
}

/// What an emoji slug becomes: replacement text, or a custom-emoji image
/// (the spec's custom-emoji map is named indirection over an inline image).
#[derive(Debug, Clone)]
pub enum EmojiResolution {
    Text(String),
    Image { url: String, alt: Option<String> },
}

fn scheme(target: &str) -> Option<String> {
    let bytes = target.as_bytes();
    if !bytes.first().is_some_and(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    let end = bytes
        .iter()
        .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'.' | b'-'))
        .count();
    if bytes.get(end) == Some(&b':') {
        Some(target[..end].to_ascii_lowercase())
    } else {
        None
    }
}

fn extension(target: &str) -> &str {
    let path = target.split(['?', '#']).next().unwrap_or("");
    match path.rfind('.') {
        Some(dot) => &path[dot + 1..],
        None => "",
    }
}

pub trait Profile {
    /// May this target become a hyperlink? Disallowed links render their
    /// children without an anchor (content survives, capability doesn't).
    fn link_allowed(&self, target: &str) -> bool {
        match scheme(target) {
            None => true, // relative references
            Some(s) => matches!(s.as_str(), "http" | "https" | "mailto"),
        }
    }

    /// Resolve an embed target to a media kind, or None for the inert
    /// fallback. The kind is resolved at render time (SPEC.md, "Media").
    fn media(&self, target: &str) -> Option<MediaResolution> {
        if !self.link_allowed(target) {
            return None;
        }
        let kind = match extension(target).to_ascii_lowercase().as_str() {
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg" => MediaKind::Image,
            "mp3" | "ogg" | "wav" | "flac" | "m4a" => MediaKind::Audio,
            "mp4" | "webm" => MediaKind::Video,
            _ => return None,
        };
        Some(MediaResolution { kind, url: target.to_string() })
    }

    /// Resolve an emoji slug to replacement text or a custom-emoji image;
    /// None renders `:slug:`. The image URL is embedder-supplied
    /// configuration, trusted like `directive` - author bytes only ever
    /// supply the slug.
    fn emoji(&self, _slug: &str) -> Option<EmojiResolution> {
        None
    }

    /// Rendered turbolink content for a target; None means the plain-link
    /// floor. Trusted embedder code (compose it from plugins). MUST be sync
    /// and fetchless - gathering happens ahead of render, never during.
    fn turbolink(&self, _target: &str, _level: TurbolinkLevel) -> Option<String> {
        None
    }

    /// The default enrichment level for a target (spec: per-scheme embedder
    /// policy); an explicit `level=` on `:::turbolink` wins over this.
    fn turbolink_level(&self, _target: &str) -> TurbolinkLevel {
        TurbolinkLevel::Full
    }

    /// Embedder directive vocabulary (widgets, includes, computed). Return
    /// rendered HTML, or None to fall through to the built-in handling.
    fn directive(&self, _name: &str, _attrs: &Attrs, _children_html: &str) -> Option<String> {
        None
    }

    /// Embedder span vocabulary. Same contract as `directive`.
    fn span(&self, _name: &str, _attrs: &Attrs, _children_html: &str) -> Option<String> {
        None
    }
}

/// The bare-web default: https links, extension-sniffed media, no widgets,
/// no emoji table, no enrichment - the trait defaults, exactly.
pub struct BareWebProfile;

impl Profile for BareWebProfile {}
