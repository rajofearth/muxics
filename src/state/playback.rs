use super::library::TrackId;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RepeatMode {
    #[default]
    Off,
    All,
    One,
}

#[derive(Debug, Default)]
pub struct Playback {
    pub queue: Vec<TrackId>,
    pub position: Option<usize>,
    pub shuffle: bool,
    pub repeat: RepeatMode,
}

impl Playback {
    pub fn current(&self) -> Option<&TrackId> {
        self.position.and_then(|i| self.queue.get(i))
    }
}
