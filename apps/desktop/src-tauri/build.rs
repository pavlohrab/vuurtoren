fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        // One permission per command (`allow-<command>`): the bundled page gets them in
        // capabilities/desktop.json and mobile.json, and no other page gets any.
        tauri_build::AppManifest::new().commands(&[
            "desktop_info",
            "links_take",
            "close_now",
            "anki_fetch",
            "sync_pick_folder",
            "sync_dir_list",
            "sync_dir_get",
            "sync_dir_put",
            "sync_dir_remove",
            "sync_fetch",
            "sync_allow_host",
            "sync_key_save",
            "sync_key_load",
            "sync_key_forget",
            "db_open",
            "db_exec",
            "db_close",
            "db_export",
            "db_import",
            "dictionary_status",
            "dictionary_gloss",
            "dictionary_entry",
            "dictionary_install",
            "audio_status",
            "audio_clip",
            "audio_install",
            "audio_remove",
            "db_reveal",
            "db_move",
            "nlp_status",
            "nlp_restart",
            "nlp_retry_packs",
            "self_test_report",
            "app_exit",
        ]),
    ))
    .expect("failed to run tauri-build");
}
