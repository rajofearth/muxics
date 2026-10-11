//! Tag + duration reading (lofty). Stub: signatures land here next.

use std::path::Path;

use anyhow::Result;

use crate::state::library::Track;

/// Read tags and duration for one file. TODO: lofty implementation.
pub fn read_track(_path: &Path) -> Result<Track> {
    anyhow::bail!("tags: not implemented yet")
}
