use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    pub watch_folders: Vec<PathBuf>,
    pub volume: f32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            watch_folders: Vec::new(),
            volume: 0.8,
        }
    }
}

impl Config {
    pub fn load() -> Self {
        Self::default()
    }

    pub fn data_dir() -> Result<PathBuf> {
        let base = dirs::data_local_dir().context("no local data dir")?;
        Ok(base.join("muxics"))
    }

    pub fn ensure_dirs() -> Result<()> {
        std::fs::create_dir_all(Self::data_dir()?)?;
        Ok(())
    }
}
