#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Draft scaffolding: allow dead code until the modules are wired together.
// TODO: remove once the first vertical slice lands.
#![allow(dead_code)]

mod app;
mod budget;
mod config;
mod logging;
mod platform;
mod services;
mod state;
mod ui;

use gpui::{AppContext, Bounds, WindowBounds, WindowOptions, point, px, size};

use app::Muxics;

fn main() {
    logging::init();

    gpui_platform::application().run(|cx| {
        // Grayscale text avoids the ~100 MB GPU-shared subpixel atlas on Windows.
        cx.set_text_rendering_mode(gpui::TextRenderingMode::Grayscale);

        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: point(px(80.), px(80.)),
                    size: size(px(1280.), px(800.)),
                })),
                app_id: Some("dev.muxics.player".into()),
                window_decorations: Some(gpui::WindowDecorations::Client),
                titlebar: None,
                ..Default::default()
            },
            |_window, cx| cx.new(|_cx| Muxics::new()),
        )
        .expect("failed to open window");
        cx.activate(true);
    });
}
