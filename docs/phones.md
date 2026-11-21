# Phones

How Vuurtoren runs on Android and iPhone, and the order to build it in.

## One app, one repository

The phone apps are the desktop app's Tauri v2 project built for Android and iOS. They share the
React UI (`apps/web`), the domain logic (`packages/core`), the event log and sync
(`packages/db`) and the Rust shell. A phone is one more device: it keeps its own copy of your
data and syncs like every other device.

```
apps/web        the UI: one code base, laid out for phone, tablet and computer
apps/desktop    Tauri v2: Windows, macOS, Linux, Android, iOS
  src-tauri/      shared Rust: database, sync files, key store, updater (desktop only)
  gen/android/    Android project (Kotlin plugins: OCR, key store, share target)
  gen/apple/      Xcode project (Swift plugins: OCR, key store, share extension)
packages/       core, db, ui, anki, ai … (unchanged)
server/         sync and the language server, used by phones
```

The Tauri project is still in `apps/desktop` (its CI, release script and sidecar build use the
path); `apps/app` is its name once they move together.

## What runs where

| Part                                               | Computer                                | Phone                                                                                           |
| -------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Your data (SQLite event log)                       | on the device                           | on the device                                                                                   |
| Sync                                               | folder, WebDAV, server                  | server (folder and WebDAV are not available on phones)                                          |
| Dictionary and short glosses                       | on the device (data pack)               | on the device (the same dictionary pack, ~14 MB)                                                |
| Analysis (spaCy), sentence translation, word pairs | bundled language server                 | the server's language server (self-hosted or Vuurtoren Cloud); results are cached on the device |
| OCR                                                | RapidOCR in the bundled language server | the phone's own engine: ML Kit on Android, Vision on iOS                                        |
| Audio                                              | audio pack, system voice as fallback    | the same                                                                                        |
| Sync key                                           | system key store                        | Android Keystore, iOS Keychain                                                                  |

A text is analysed once, when it is added, and the analysis is stored on the device. Reading,
glosses, reviews and practice then work offline. Only adding a new text, translating a new
sentence and the side-by-side mode need the server.

## Design for phones

The redesign sets the phone layout; the desktop keeps its layout and gains the same motion.

- **Navigation:** a bottom bar with Read, Words, Review and More (Grammar, Exam, Courses, Talk, Progress, Settings).
- **Reader:** large Literata text, a sheet for the word inspector, the interlinear English mode
  (English under each sentence, tap a word on either line to see its partner, a structure view per
  sentence), side by side when the phone is turned sideways.
- **Review:** one card at a time; swipe right for Good, left for Again; buttons stay for every
  grade; a light haptic on each answer.
- **Speed:** every screen opens from the local database with no spinner; actions change the
  screen first and save behind it; sync runs on start, on resume and a few seconds after a change.
- **Motion:** View Transitions between screens (a cover grows into the reader), springs for
  sheets and cards, the amber highlight sweeping in once on new words; all of it off under
  "reduce motion".
- **Comfort:** 44 px touch targets, the main action within thumb reach, sheets instead of dialogs,
  safe-area insets, dark mode, Dynamic Type / font scale respected.

## Platform layer

`apps/web/src/platform/` gives the UI one interface for what differs per device: key store,
files and sharing, OCR, speech, haptics, notifications, the language-server address. The
browser, the desktop app and each phone provide an implementation; the UI asks for a capability
and hides what a device lacks.

## Order of work

1. **Shared foundations** (both phones depend on them):
   - phone layouts from the redesign in `apps/web` (navigation, sheets, reader, review);
   - the platform layer;
   - the dictionary pack read on the device, without the language server;
   - analysis cached per text, so reading is offline once a text is added;
   - a server address and sync token set up together on first start ("Connect to your
     Vuurtoren server" with a QR code from the server's Settings → Sync).
2. **Android**: the details are in [Android](android.md).
3. **iPhone** (below).

## Android

- **Build:** `tauri android init`; Android Studio or the command-line SDK on Linux; CI on a
  Linux runner (the cheapest).
- **Native pieces (Kotlin plugins):**
  - sync key in the Android Keystore;
  - OCR with ML Kit text recognition (on device, no Google account);
  - "Share to Vuurtoren" from the browser or any app (intent filter) to import an article;
  - review reminders (notifications);
  - haptics.
- **Data:** the database in the app's private storage; backups through Android's backup rules
  (the sync key is excluded).
- **Distribution, in order:**
  1. a signed APK on GitHub releases (sideload) for testing;
  2. Google Play: internal testing, then open testing, then production (one-time $25
     developer account, an upload key, the Data safety form);
  3. F-Droid later (needs a reproducible build without proprietary libraries; ML Kit would have
     to be optional there).
- **Test devices:** one mid-range phone (Android 11+), one recent phone, a tablet; the Android
  emulator for layouts.

## iPhone

- **Needs:** a Mac with Xcode for builds and signing, and an Apple Developer account ($99 a
  year). CI on macOS runners costs more minutes; build releases locally on the Mac at first.
- **Build:** `tauri ios init`; signing with an automatic profile; TestFlight for testers.
- **Native pieces (Swift plugins):**
  - sync key in the Keychain;
  - OCR with the Vision framework (on device);
  - a share extension so Safari's Share menu can send an article (a separate small target in the
    Xcode project);
  - review reminders (notifications);
  - haptics.
- **App Store review:**
  - the app must be useful on its own: reading your own texts, the starter words, reviews and
    practice work offline after the first analysis, and the demo works without a server;
  - an account is never required to try it;
  - a privacy manifest and a privacy label (no tracking; the server address is the user's own);
  - the AI key is entered by the user and stays on the device.
- **Test devices:** an iPhone with a notch and one without, an iPad for the side-by-side layout.

## Later

- On-device translation with an ONNX build of the translation model (~90 MB), so new sentences
  translate without a server.
- A smaller on-device analyser for adding texts offline.
