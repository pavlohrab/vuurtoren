//! What only a phone has: the QR scanner (to connect to a server), `vuurtoren://connect` links
//! and, on Android, the sync key in the Android Keystore through the Kotlin plugin
//! `KeystorePlugin` (gen/android/app/src/main/java/app/vuurtoren/KeystorePlugin.kt).

use std::sync::Arc;

use tauri::{AppHandle, Wry};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::keys;

/// The phone's plugins: the QR scanner, links, and the key store.
pub fn plugins(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    let builder = builder
        .plugin(tauri_plugin_barcode_scanner::init())
        .plugin(tauri_plugin_deep_link::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(android::plugin());
    builder
}

/// The link the app was opened with, and every link that opens it later, go to the page.
pub fn after_window(app: &AppHandle) {
    let deep = app.deep_link();
    if let Ok(Some(urls)) = deep.get_current() {
        for url in urls {
            crate::link_arrived(app, url.to_string());
        }
    }
    let handle = app.clone();
    deep.on_open_url(move |event| {
        for url in event.urls() {
            crate::link_arrived(&handle, url.to_string());
        }
    });
}

#[cfg(target_os = "android")]
pub fn key_store(app: &tauri::App) -> tauri::Result<Arc<dyn keys::KeyStore>> {
    use tauri::Manager as _;
    Ok(Arc::new(
        app.state::<android::AndroidKeys>().inner().clone(),
    ))
}

#[cfg(not(target_os = "android"))]
pub fn key_store(app: &tauri::App) -> tauri::Result<Arc<dyn keys::KeyStore>> {
    use tauri::Manager as _;
    Ok(Arc::new(keys::FileKeys(app.path().app_data_dir()?)))
}

#[cfg(target_os = "android")]
mod android {
    use serde::{Deserialize, Serialize};
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::{Manager as _, Wry};

    use crate::keys::{self, Kept};

    /// The Kotlin plugin's package and class.
    const PACKAGE: &str = "app.vuurtoren";
    const CLASS: &str = "KeystorePlugin";

    /// The sync key sealed by the Android Keystore (the Kotlin plugin does the sealing).
    #[derive(Clone)]
    pub struct AndroidKeys(PluginHandle<Wry>);

    #[derive(Serialize)]
    struct SaveArgs<'a> {
        name: &'a str,
        key: &'a str,
    }

    #[derive(Serialize)]
    struct NameArgs<'a> {
        name: &'a str,
    }

    #[derive(Deserialize)]
    struct Loaded {
        key: Option<String>,
    }

    pub fn plugin() -> TauriPlugin<Wry> {
        Builder::new("vuurtoren-keystore")
            .setup(|app, api| {
                let handle = api.register_android_plugin(PACKAGE, CLASS)?;
                app.manage(AndroidKeys(handle));
                Ok(())
            })
            .build()
    }

    fn failed(what: &str, e: impl std::fmt::Display) -> String {
        format!("The Android Keystore could not {what} the sync key: {e}")
    }

    impl keys::KeyStore for AndroidKeys {
        fn save(&self, name: &str, key: &str) -> Result<Kept, String> {
            keys::check(key)?;
            self.0
                .run_mobile_plugin::<serde_json::Value>("save", SaveArgs { name, key })
                .map_err(|e| failed("keep", e))?;
            Ok(Kept::Keystore)
        }

        fn load(&self, name: &str) -> Result<Option<String>, String> {
            let loaded: Loaded = self
                .0
                .run_mobile_plugin("load", NameArgs { name })
                .map_err(|e| failed("open", e))?;
            Ok(loaded.key.filter(|k| !k.is_empty()))
        }

        fn forget(&self, name: &str) -> Result<(), String> {
            self.0
                .run_mobile_plugin::<serde_json::Value>("forget", NameArgs { name })
                .map_err(|e| failed("forget", e))?;
            Ok(())
        }
    }
}
