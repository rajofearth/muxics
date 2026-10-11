use std::path::{Path, PathBuf};

use anyhow::Result;
use walkdir::WalkDir;

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "ogg", "oga", "opus", "m4a", "aac", "wav", "aiff", "wma",
];

/// Collect audio files under `root` with a single-threaded walk. Tag parsing
/// (not I/O) is what gets parallelized later with rayon.
pub fn collect_audio_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let is_audio = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if is_audio {
            out.push(entry.into_path());
        }
    }
    Ok(out)
}
