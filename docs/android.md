# Android

The Android app in detail: how it is built, what runs on the phone, how it looks, and the
milestones to get there. The overview for both phones is in [Phones](phones.md).

## Shape of the app

The Android app is the Tauri v2 app (`apps/desktop`, renamed `apps/app` with this work) built for
Android. The UI is the same React app (`apps/web`) inside the Android System WebView; Rust runs
the database and the sync files; a few Kotlin plugins reach what only Android offers.

```
apps/app/
  src-tauri/
    src/            shared Rust: database (rusqlite), sync files, key store trait, packs
    capabilities/   per platform: desktop.json, mobile.json (what the page may call)
    gen/android/    generated Android project (Gradle); our Kotlin plugins live beside it
  plugins/
    keystore/       Kotlin: sync key in the Android Keystore
    ocr/            Kotlin: ML Kit text recognition (on device)
    share/          Kotlin: "Share to Vuurtoren" intent → import
apps/web/src/platform/
  index.ts          the capability interface the UI asks
  android.ts        the Android implementation (invoke → Rust / plugins)
```

## What runs where

| Need                                                     | On the phone                                                                            | Notes                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Your data                                                | SQLite file in the app's private storage, opened by Rust (`rusqlite`, bundled SQLite)   | the same event log and projections as desktop                   |
| Sync                                                     | the server place only (`/api/sync`), through Rust HTTP                                  | folder and WebDAV are desktop-only                              |
| Sync key                                                 | Android Keystore (Kotlin plugin)                                                        | excluded from Android backups                                   |
| Dictionary, short glosses, starter words                 | on the phone: the `dictionary-nl` pack (~14 MB) downloaded on first start, read by Rust | glosses work offline                                            |
| Audio                                                    | the `audio-nl` pack (female or male), downloaded on first start or later in Settings    | played with the page's `<audio>` through Tauri's asset protocol |
| Analysis of a new text, sentence translation, word pairs | the server's language server (`/nlp/`, with the device's sync token)                    | results cached per text; reading is offline afterwards          |
| OCR (photo of a page)                                    | ML Kit text recognition, on device                                                      | no Google account, no network                                   |
| Speech fallback                                          | Android text-to-speech through the WebView                                              | used only when a clip is missing                                |
| Reminders                                                | `tauri-plugin-notification`                                                             | "24 reviews due" once a day, at a time you choose               |
| Haptics                                                  | `tauri-plugin-haptics`                                                                  | a light tick on each review answer                              |
| Connect to a server                                      | `tauri-plugin-barcode-scanner` reads a QR code from the server's Settings → Sync        | the QR holds the address and a new sync token                   |
| Links                                                    | `tauri-plugin-deep-link`: `vuurtoren://connect?…`                                       | the same as the QR code                                         |

## First start

1. Welcome, then "Do you use Anki?" (as on desktop; on a phone, Anki import is a `.apkg` file).
2. **Connect to your Vuurtoren server**: scan the QR code, type the address, or "Not now".
   Without a server the app still works: the starter words, reviews and the demo text. Adding a
   new text asks for a server.
3. The starter words: where new words start (level 1, 2, 3, 5 or 7).
4. Downloads, with progress and sizes: dictionary (14 MB, needed), audio with both voices
   (about 80 MB, optional).

## Design

The phone layout from the redesign; the colours, type and logo stay as on desktop.

- **Navigation:** a bottom bar with Home, Library, Review, Words. Settings sit behind the round
  button at the top of Home. The Android **back gesture** goes back in the app's history
  (predictive back where the system offers it) and closes sheets first.
- **Edge to edge:** content runs under the status and navigation bars; padding comes from the
  insets. The status bar follows the theme (light or dark).
- **Reader:** large Literata text; a tap on a word opens a bottom sheet (meaning, play, Add to my
  words, I know it). English under the sentences (Always / only hard sentences / tap to show),
  tap to match words both ways, the structure view per sentence. Turned sideways: side by side.
- **Review:** one card; tap to reveal; swipe right for Good, left for Again; the four grade
  buttons stay at the bottom. A light haptic on each answer. Play buttons for the word and the
  sentence; autoplay as set.
- **Library:** shelves by level ("Start here", A2, B1, B2) with how much you already know.
- **Motion:** shared-element transitions (cover → reader), springs on sheets and cards, the amber
  highlight sweeping in once on new words. "Remove animations" in Android's accessibility settings
  turns them off.
- **Comfort:** 48 dp touch targets (Android's minimum), the main action within thumb reach,
  system font scale respected up to 200%, dark theme following the system.
- **Splash:** Android 12's splash screen with the lighthouse mark on the paper colour.

## Building

- **Tools:** Android Studio (or the command-line SDK), JDK 17, the NDK, and Rust targets
  `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`.
- **Start:** `pnpm --filter @app/desktop tauri android init`, then `tauri android dev` with a phone
  connected (USB debugging) or the emulator.
- **Minimum Android:** 8.0 (API 26); target the latest API level Google Play requires.
- **Release build:** `tauri android build --aab` for Google Play, `--apk` for sideloading. Signed
  with an upload key kept outside the repository (Play App Signing holds the app key).
- **CI:** a Linux runner (the cheapest) builds the `.apk` and `.aab` on a `v*` tag and attaches
  the `.apk` to the GitHub release.

## Milestones

Each one ends with something you can install and try.

1. **It runs.** `tauri android init`; the app opens on a phone with the demo; Rust database on
   device; the platform layer with `android.ts`. _Check:_ the demo works offline on a phone.
2. **Your data, synced.** Connect to a server by QR code; the sync key in the Keystore; sync on
   start, on resume and a few seconds after a change. _Check:_ a review on the phone shows on the
   desktop within 20 seconds.
3. **Reading.** The dictionary pack on device; adding a text through the server; the reader with
   sheets, English under sentences, tap to match. _Check:_ read a text in flight mode after adding
   it at home.
4. **Review and audio.** The review screen with swipe and haptics; the audio pack; reminders.
   _Check:_ a week of daily reviews on the phone only.
5. **Android extras.** OCR with ML Kit; "Share to Vuurtoren" from Chrome; `.apkg` import from
   Files. _Check:_ photograph a page of a book and read it.
6. **Release.** Signed `.apk` on GitHub; Google Play internal testing, then open testing (the
   Data safety form: no tracking; data stays on the device and your own server).

## Open questions

- Store the reading analysis in the event log (synced, so a text added on the desktop is ready on
  the phone) or keep it per device (smaller sync, but the phone needs the server once per text)?
  Today it is per device.
- F-Droid: ML Kit is not free software; an F-Droid build would need OCR off or another engine.
