fn main() {
    println!("cargo::rerun-if-changed=assets/app.rc");
    println!("cargo::rerun-if-changed=assets/app.manifest");
    // Manifest (+ icon later) is Windows-only. The result is intentionally
    // ignored so a missing rc.exe never breaks a fresh checkout.
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" {
        return;
    }
    // NOTE: do NOT embed our own RT_MANIFEST here. GPUI already embeds one
    // (asInvoker, PerMonitorV2, Win10 compat) and a second manifest fails the
    // link with CVT1100 duplicate resource. app.rc is kept for the future
    // icon; the manifest stays GPUI's.
    let _ = embed_resource::compile("assets/app.rc", embed_resource::NONE);
}
