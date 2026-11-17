# ADR 0001 — TypeScript core + React UI, Tauri desktop, WXT extension

**Status:** accepted (2026-11-17)

**Context:** One solo developer needs web (self-host), desktop, a browser extension and, later, mobile.

**Decision:**

- One pure TypeScript core (`packages/core`) and one React UI (`packages/ui`).
- Shells: Vite PWA (first), Tauri v2 (desktop), WXT (extension), Capacitor (mobile, later).
- Platform access goes through ports (`Db`, `Fs`, `Http`, `Secrets`, `Ocr`, `Anki`, `Nlp`, `Translate`, `Llm`).

**Consequences:**

- One language and one UI.
- Webview UIs are not fully native on iOS; Expo stays a fallback for mobile UI.
- Hot paths can move to Rust/WASM later behind the same interfaces.
