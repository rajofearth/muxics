use gpui::{
    Context, FontWeight, InteractiveElement, IntoElement, ParentElement, Styled, WindowControlArea,
    div, px,
};

use crate::app::Muxics;

/// Frameless titlebar. The bar is the window drag area; the three caption
/// buttons carry no click handlers because the window manager runs them.
pub fn render(muxics: &Muxics, _cx: &mut Context<Muxics>) -> impl IntoElement {
    let p = muxics.palette;
    div()
        .flex()
        .items_center()
        .gap(px(10.))
        .h(px(38.))
        .px(px(12.))
        .flex_none()
        .border_b_1()
        .border_color(p.border)
        .bg(p.surface)
        .window_control_area(WindowControlArea::Drag)
        .child(
            div()
                .text_size(px(12.5))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(p.muted_foreground)
                .child("Muxics"),
        )
        .child(
            div()
                .flex_1()
                .text_size(px(12.))
                .text_color(p.muted_foreground)
                .child(format!(
                    "local-first draft · v{}",
                    env!("CARGO_PKG_VERSION")
                )),
        )
        .child(caption_button("minimize", "—", WindowControlArea::Min, p))
        .child(caption_button("maximize", "▢", WindowControlArea::Max, p))
        .child(caption_button("close", "✕", WindowControlArea::Close, p))
}

fn caption_button(
    id: &'static str,
    glyph: &'static str,
    area: WindowControlArea,
    p: crate::ui::theme::Palette,
) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_center()
        .occlude()
        .cursor_default()
        .window_control_area(area)
        .hover(|s| s.bg(p.border))
        .p(px(4.))
        .px(px(10.))
        .text_size(px(12.))
        .text_color(p.muted_foreground)
        .child(glyph)
}
