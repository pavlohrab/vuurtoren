// Injected into every page the Kenning window loads (the bundled home page and the user's
// server). The web app looks for `window.__KENNING_DESKTOP__` (apps/web/src/desktop/bridge.ts).
// Server pages may only use anki_fetch, change_server and desktop_info (runtime capability in
// lib.rs); everything else (the offline app's database and language server) is rejected by
// Tauri's ACL for them.
(function () {
  "use strict";
  if (window.__KENNING_DESKTOP__) return;
  var HOME = "__HOME_ORIGIN__";
  function invoke(cmd, args) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  Object.defineProperty(window, "__KENNING_DESKTOP__", {
    value: Object.freeze({
      // Not `location.origin`: custom schemes (tauri://) can report an opaque "null" origin.
      home: location.protocol + "//" + location.host === HOME,
      info: function () {
        return invoke("desktop_info");
      },
      checkServer: function (url) {
        return invoke("check_server", { url: url });
      },
      connect: function (url) {
        return invoke("connect", { url: url });
      },
      changeServer: function () {
        return invoke("change_server");
      },
      ankiFetch: function (req) {
        return invoke("anki_fetch", { req: req });
      },
      // Offline mode, home page only.
      useLocal: function () {
        return invoke("use_local");
      },
      db: Object.freeze({
        open: function (force) {
          return invoke("db_open", { force: !!force });
        },
        exec: function (sql, params) {
          return invoke("db_exec", { sql: sql, params: params });
        },
        close: function () {
          return invoke("db_close");
        },
        // Raw bytes both ways (no JSON for a whole database file).
        exportFile: function () {
          return invoke("db_export");
        },
        importFile: function (bytes, deviceId, maxSchema) {
          return invoke("db_import", bytes, {
            headers: { "x-device-id": deviceId, "x-max-schema": String(maxSchema) },
          });
        },
        reveal: function () {
          return invoke("db_reveal");
        },
        move: function () {
          return invoke("db_move");
        },
      }),
      nlp: Object.freeze({
        status: function () {
          return invoke("nlp_status");
        },
        restart: function () {
          return invoke("nlp_restart");
        },
        retryPacks: function () {
          return invoke("nlp_retry_packs");
        },
      }),
    }),
  });
})();
