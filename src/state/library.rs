use std::path::PathBuf;

/// Stable identity for a track. Local tracks are keyed by path; remote tracks
/// (later) by provider id. Playlists and the queue hold ids, never copies.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct TrackId(pub String);

#[derive(Clone, Debug)]
pub struct Track {
    pub id: TrackId,
    pub path: Option<PathBuf>,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: Option<u64>,
}

/// Canonical track store. This is the single source of truth; every other
/// view resolves ids against it at render time.
#[derive(Debug, Default)]
pub struct Library {
    tracks: Vec<Track>,
}

impl Library {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, track: Track) {
        self.tracks.push(track);
    }

    pub fn get(&self, id: &TrackId) -> Option<&Track> {
        self.tracks.iter().find(|t| &t.id == id)
    }

    pub fn len(&self) -> usize {
        self.tracks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Track {
        Track {
            id: TrackId("local:/music/a.mp3".into()),
            path: Some(PathBuf::from("/music/a.mp3")),
            title: "A".into(),
            artist: "B".into(),
            album: "C".into(),
            duration_secs: Some(200),
        }
    }

    #[test]
    fn resolves_by_id() {
        let mut lib = Library::new();
        assert!(lib.is_empty());
        lib.push(sample());
        assert_eq!(lib.len(), 1);
        let t = lib.get(&TrackId("local:/music/a.mp3".into())).unwrap();
        assert_eq!(t.title, "A");
        assert!(lib.get(&TrackId("missing".into())).is_none());
    }
}
