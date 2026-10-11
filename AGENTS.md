## Non-obvious rules (learned the hard way)

- Toolchain is **1.95.0** (`rust-toolchain.toml`). Stable can't build GPUI.
- GPUI is a pinned git rev, not crates.io. Never `cargo add gpui --git`.
  Upgrades are porting projects; commit `Cargo.lock`.
- New native/C dependencies must prove they compile on this machine first.
  `ring` doesn't (broken MSVC env); pure Rust and `cc`-built C usually do.
- No `RT_MANIFEST` in `assets/app.rc`. GPUI embeds its own; a second one
  fails the link (CVT1100). The rc is icon + `VERSIONINFO` only.
- `Grayscale` text at startup; subpixel costs ~100 MB GPU-shared.
- The texture atlas never evicts: cap artwork, `drop_image` evicted rasters.
- `services/` never imports `gpui`. One source of truth per concern.
- Release uses `panic = "abort"`. Isolate panic-prone work.
- Frameless = `titlebar: None` + `Drag` regions, `occlude()` on children.
- Never raise the ceilings in `src/budget.rs` to green the test. Shrink
  the binary instead, and ask first.

## How to work

- Parallel subagents for independent work; verify claims against source.
- `cargo check` clean, `cargo test` green before calling anything done.
- Commit only when asked. `git status` first; stage only intended files.

## Background

- Electron audit: https://audit-site-lemon.vercel.app
- GPUI feasibility: https://gpui-site.vercel.app
- Hybrid remote plan: https://hybrid-site-alpha.vercel.app
