fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        // One permission per command (`allow-<command>`), so pages from the user's server can be
        // given only the bridge commands (see `allow_server` in src/lib.rs).
        tauri_build::AppManifest::new().commands(&[
            "desktop_info",
            "check_server",
            "connect",
            "change_server",
            "anki_fetch",
        ]),
    ))
    .expect("failed to run tauri-build");
}
