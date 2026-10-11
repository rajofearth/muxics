# Muxics (Rust)

Local-first native music player. Rust + GPUI. Draft scaffolding.

## Commands

| Command | Does |
|---|---|
| `cargo run` | Run (debug) |
| `cargo run --release` | Run (size-minded release) |
| `cargo check` | Fast type-check |
| `cargo test` | Unit tests + budget report |
| `cargo fmt` / `cargo clippy` | Format / lint |

Toolchain is pinned in `rust-toolchain.toml` (1.95.0). GPUI is a pinned
git rev, not crates.io. First build takes several minutes (large dep tree).

## Layout

`app/` behaviour, the only place state mutates. `state/` single source of
truth (GPUI entities). `ui/` render only. `services/` pure code with no
`gpui` imports. `platform/` Win32 glue. Budgets are enforced in
`src/budget.rs`: ~10 MB release binary, 100 MiB non-GPU working set.
