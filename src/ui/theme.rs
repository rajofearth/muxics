use gpui::{Rgba, rgb};

/// Design tokens. Single accent, neutral surfaces. OKLCH values are baked to
/// sRGB hex offline (GPUI has no OKLCH constructor); keep neutrals at zero
/// saturation and test the invariants when this grows.
#[derive(Clone, Copy, Debug)]
pub struct Palette {
    pub background: Rgba,
    pub surface: Rgba,
    pub border: Rgba,
    pub foreground: Rgba,
    pub muted_foreground: Rgba,
    pub accent: Rgba,
}

impl Palette {
    pub fn dark() -> Self {
        Self {
            background: rgb(0x0a0a0b),
            surface: rgb(0x131316),
            border: rgb(0x26262b),
            foreground: rgb(0xf4f4f5),
            muted_foreground: rgb(0xa1a1aa),
            accent: rgb(0xa78bfa),
        }
    }
}
