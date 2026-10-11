#[derive(Clone, Debug)]
pub struct Settings {
    pub volume: f32,
    pub shuffle: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            volume: 0.8,
            shuffle: false,
        }
    }
}
