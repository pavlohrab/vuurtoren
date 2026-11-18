// Injected into every page the Kenning window loads (the bundled home page and the user's
// server). The web app looks for `window.__KENNING_DESKTOP__` (apps/web/src/desktop/bridge.ts).
// Server pages may only use anki_fetch, change_server and desktop_info (runtime capability in
// lib.rs); everything else is rejected by Tauri's ACL for them.
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
    }),
  });
})();
