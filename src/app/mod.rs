pub mod commands;

use gpui::{Context, IntoElement, ParentElement, Render, Styled, Window, div};

use crate::{config::Config, state::playback::RepeatMode, ui};

/// Root entity. Owns top-level state and renders the shell; every mutation
/// funnels through `commands.rs`.
pub struct Muxics {
    pub config: Config,
    pub palette: ui::theme::Palette,
    pub repeat: RepeatMode,
}

impl Muxics {
    pub fn new() -> Self {
        Self {
            config: Config::load(),
            palette: ui::theme::Palette::dark(),
            repeat: RepeatMode::default(),
        }
    }
}

impl Default for Muxics {
    fn default() -> Self {
        Self::new()
    }
}

impl Render for Muxics {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palette;
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(p.background)
            .text_color(p.foreground)
            .child(ui::titlebar::render(self, cx))
            .child(
                div()
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(p.muted_foreground)
                    .child("Muxics — local-first draft. Library, audio, and remote land here."),
            )
    }
}
