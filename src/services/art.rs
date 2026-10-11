//! Artwork pipeline (decode + downscale + dominant color + disk cache).
//! Stub: image + fast_image_resize + color-thief land here next. Decoding
//! stays off the render path; the UI only ever reads cached rasters.
