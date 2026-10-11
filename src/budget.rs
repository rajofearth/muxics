//! Binary-size and RAM budget gates. The release binary must stay small and
//! the non-GPU working set under 100 MiB. GPU-shared memory is excluded by
//! product policy (it is driver-owned).

pub const MAX_RELEASE_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_NON_GPU_WORKING_SET_BYTES: u64 = 100 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    /// Prints the release binary size and fails if it exceeds the ceiling.
    /// Passes (with a note) when no release binary exists, unless
    /// MUXICS_BUDGET_REQUIRE_RELEASE=1.
    #[test]
    fn budgets_report() {
        match release_binary_path() {
            Some(path) => {
                let bytes = std::fs::metadata(&path).unwrap().len();
                println!("release binary: {} ({} bytes)", path.display(), bytes);
                println!("ceiling: {MAX_RELEASE_BYTES} bytes");
                assert!(bytes <= MAX_RELEASE_BYTES, "release binary exceeds size budget");
            }
            None => {
                println!("no release binary found; skipping size gate");
                assert!(
                    std::env::var("MUXICS_BUDGET_REQUIRE_RELEASE").is_err(),
                    "MUXICS_BUDGET_REQUIRE_RELEASE=1 but no release binary built"
                );
            }
        }
        println!("non-GPU working-set ceiling: {MAX_NON_GPU_WORKING_SET_BYTES} bytes");
    }

    fn release_binary_path() -> Option<std::path::PathBuf> {
        // Unit tests run from target/debug/deps/<name>-<hash>[.exe]; the
        // release binary lives at target/release/muxics[.exe].
        let mut dir = std::env::current_exe().ok()?;
        dir.pop();
        if dir.ends_with("deps") {
            dir.pop();
            dir.pop();
        }
        let exe = if cfg!(windows) { "muxics.exe" } else { "muxics" };
        let path = dir.join("release").join(exe);
        path.is_file().then_some(path)
    }
}
