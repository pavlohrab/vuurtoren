fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        // One permission per command (`allow-<command>`), so pages from the user's server can be
        // given only the bridge commands (the offline-mode commands stay on the home page) (see `allow_server` in src/lib.rs).
        tauri_build::AppManifest::new().commands(&[
            "desktop_info",
            "check_server",
            "connect",
            "change_server",
            "anki_fetch",
            "use_local",
            "db_open",
            "db_exec",
            "db_close",
            "db_export",
            "db_import",
            "db_reveal",
            "db_move",
            "nlp_status",
            "nlp_restart",
            "nlp_retry_packs",
        ]),
    ))
    .expect("failed to run tauri-build");
}
