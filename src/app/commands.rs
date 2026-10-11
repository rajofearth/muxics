use super::Muxics;

/// Behaviour entry points. Every mutation to `Muxics` lands in a method here
/// so actions, menus, shortcuts, and (later) the command palette share one path.
impl Muxics {
    /// TODO: wire to services::audio once the engine lands.
    pub fn play_pause(&mut self) {}

    /// TODO: advance the queue in state::playback.
    pub fn next_track(&mut self) {}

    /// TODO: go back in the queue in state::playback.
    pub fn prev_track(&mut self) {}
}
