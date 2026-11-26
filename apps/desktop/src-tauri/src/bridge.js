// Injected into the page the Vuurtoren window loads (the bundled web build). The web app looks
// for `window.__VUURTOREN_DESKTOP__` (apps/web/src/desktop/bridge.ts). Any other page the window
// might show gets no commands: Tauri's ACL (capabilities/desktop.json, mobile.json) allows them for the
// bundled page only.
(function () {
  "use strict";
  if (window.__VUURTOREN_DESKTOP__) return;
  var HOME = "__HOME_ORIGIN__";
  // The device: "linux", "macos", "windows" or "android" (lib.rs fills it in).
  var OS = "__OS__";
  function invoke(cmd, args) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  // Closing the window (lib.rs calls this): run what the page asked for first (its last sync),
  // at most a few seconds, then let the window close.
  var beforeClose = null;
  Object.defineProperty(window, "__VUURTOREN_CLOSING__", {
    value: function () {
      var close = function () {
        invoke("close_now");
      };
      if (!beforeClose) return close();
      var waited = new Promise(function (resolve) {
        setTimeout(resolve, 4500);
      });
      Promise.race([Promise.resolve().then(beforeClose), waited]).then(close, close);
    },
  });
  function toBase64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  function fromBase64(text) {
    var s = atob(text);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  Object.defineProperty(window, "__VUURTOREN_DESKTOP__", {
    value: Object.freeze({
      // Not `location.origin`: custom schemes (tauri://) can report an opaque "null" origin.
      home: location.protocol + "//" + location.host === HOME,
      os: OS,
      info: function () {
        return invoke("desktop_info");
      },
      // Focus mode in the reader: the window fills the screen, and back.
      fullscreen: function (on) {
        return invoke("plugin:window|set_fullscreen", { label: "main", value: !!on });
      },
      // What to do before the window closes (the page's last sync); returns its removal.
      beforeClose: function (fn) {
        beforeClose = fn;
        return function () {
          if (beforeClose === fn) beforeClose = null;
        };
      },
      ankiFetch: function (req) {
        return invoke("anki_fetch", { req: req });
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
      // Sync: a folder you already sync, and requests to sync places the page cannot reach
      // itself. Bytes travel as base64.
      sync: Object.freeze({
        pickFolder: function () {
          return invoke("sync_pick_folder");
        },
        list: function (root, dir) {
          return invoke("sync_dir_list", { root: root, dir: dir });
        },
        get: function (root, path) {
          return invoke("sync_dir_get", { root: root, path: path }).then(function (b64) {
            return b64 == null ? null : fromBase64(b64);
          });
        },
        put: function (root, path, bytes) {
          return invoke("sync_dir_put", { root: root, path: path, data: toBase64(bytes) });
        },
        remove: function (root, path) {
          return invoke("sync_dir_remove", { root: root, path: path });
        },
        // The app asks the user the first time an address is used; sync_fetch reaches only
        // allowed addresses.
        allowHost: function (url) {
          return invoke("sync_allow_host", { url: url });
        },
        // The sync key (base64; name absent) or a server's sync token (name "sync-token") in the
        // device's key store: the system keychain or a private file, the Android Keystore.
        saveKey: function (key, name) {
          return invoke("sync_key_save", { key: key, name: name || null });
        },
        loadKey: function (name) {
          return invoke("sync_key_load", { name: name || null });
        },
        forgetKey: function (name) {
          return invoke("sync_key_forget", { name: name || null });
        },
        fetch: function (req) {
          return invoke("sync_fetch", {
            req: {
              url: req.url,
              method: req.method,
              headers: req.headers || {},
              bodyBase64: req.body ? toBase64(req.body) : null,
              // "Connect a phone": trust only the computer's certificate from the QR code.
              pinned: req.pinned || null,
            },
          }).then(function (res) {
            return { status: res.status, headers: res.headers, body: fromBase64(res.bodyBase64) };
          });
        },
        // The typed code (SY9): the computer's certificate and its proof that it knows the code.
        probe: function (base, nonce) {
          return invoke("sync_probe", { base: base, nonce: nonce });
        },
      }),
      // "Connect a phone" on a computer (lan_cmd.rs): listen for phones, make a code with the
      // handover (place + key), list and remove phones.
      lan:
        OS === "android" || OS === "ios"
          ? undefined
          : Object.freeze({
              start: function (folder) {
                return invoke("lan_start", { folder: folder || null });
              },
              code: function (handover) {
                return invoke("lan_code", { handover: handover || null });
              },
              phones: function () {
                return invoke("lan_phones");
              },
              remove: function (hash) {
                return invoke("lan_remove", { hash: hash });
              },
              moved: function () {
                return invoke("lan_moved");
              },
              asking: function () {
                return invoke("lan_asking");
              },
              answer: function (id, yes) {
                return invoke("lan_answer", { id: id, yes: yes });
              },
              firewall: function (port) {
                return invoke("lan_firewall", { port: port });
              },
              allowFirewall: function (port) {
                return invoke("lan_firewall_allow", { port: port });
              },
            }),
      // vuurtoren:// links that opened the app (phones): taken once; "vuurtoren-link" says a
      // new one arrived.
      links: Object.freeze({
        take: function () {
          return invoke("links_take");
        },
        onArrive: function (fn) {
          window.addEventListener("vuurtoren-link", fn);
          return function () {
            window.removeEventListener("vuurtoren-link", fn);
          };
        },
      }),
      // Android Back (button or gesture). While the page listens, Tauri's app plugin hands every
      // Back to it instead of going back in the WebView or closing the app; `exit` leaves.
      back:
        OS === "android"
          ? Object.freeze({
              listen: function (fn) {
                var internals = window.__TAURI_INTERNALS__;
                var id = internals.transformCallback(function (e) {
                  var data = e && typeof e === "object" && "message" in e ? e.message : e;
                  fn({ canGoBack: !!(data && data.canGoBack) });
                });
                var registered = invoke("plugin:app|register_listener", {
                  event: "back-button",
                  handler: "__CHANNEL__:" + id,
                });
                return function () {
                  registered
                    .then(function () {
                      return invoke("plugin:app|remove_listener", {
                        event: "back-button",
                        channelId: id,
                      });
                    })
                    .catch(function () {})
                    .then(function () {
                      internals.unregisterCallback(id);
                    });
                };
              },
              exit: function () {
                return invoke("app_exit");
              },
            })
          : undefined,
      // A QR code from the camera (phones): its text, or null when cancelled or not allowed.
      scanQr:
        OS === "android" || OS === "ios"
          ? function () {
              return invoke("plugin:barcode-scanner|request_permissions")
                .then(function (p) {
                  if (p && p.camera !== "granted") return null;
                  // Windowed: the camera shows behind a see-through page, which draws its own
                  // frame, hint and Cancel over it (the page's ScanOverlay).
                  return invoke("plugin:barcode-scanner|scan", {
                    formats: ["QR_CODE"],
                    windowed: true,
                  }).then(function (r) {
                    return (r && r.content) || null;
                  });
                })
                .catch(function (e) {
                  if (String(e).indexOf("cancel") >= 0) return null;
                  throw e;
                });
            }
          : undefined,
      // Stop a running scan (the overlay's Cancel); the scan then gives null.
      cancelScan:
        OS === "android" || OS === "ios"
          ? function () {
              return invoke("plugin:barcode-scanner|cancel").then(function () {});
            }
          : undefined,
      // The dictionary pack on a phone (dictionary.rs): meanings without a server.
      dictionary:
        OS === "android" || OS === "ios"
          ? Object.freeze({
              status: function () {
                return invoke("dictionary_status");
              },
              gloss: function (words) {
                return invoke("dictionary_gloss", { words: words });
              },
              // Everything the word card shows about one word (the server's /entry shape).
              entry: function (word, pos) {
                return invoke("dictionary_entry", { word: word, pos: pos || null });
              },
              // from: { nlp: "<server>/nlp", token } (the connected server) or null.
              install: function (from) {
                return invoke("dictionary_install", { from: from || null });
              },
            })
          : undefined,
      // The recordings pack on a phone (audio.rs): recorded words and sentences without a server.
      audio:
        OS === "android" || OS === "ios"
          ? Object.freeze({
              status: function () {
                return invoke("audio_status");
              },
              // An mp3 as an ArrayBuffer (empty when the pack has no such clip).
              clip: function (voice, id) {
                return invoke("audio_clip", { voice: voice, id: id });
              },
              install: function (from) {
                return invoke("audio_install", { from: from || null });
              },
              remove: function () {
                return invoke("audio_remove");
              },
            })
          : undefined,
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
