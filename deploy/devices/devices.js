// The server's one page: sign in, add a device (a pairing code as a QR code and a link), list
// the devices that sync and remove one. It uses the API only: /api/auth/* and /api/sync/pair-code.
// No data of the app is here: the devices keep it.
"use strict";

const $ = (id) => document.getElementById(id);
const JSON_HEADERS = { "content-type": "application/json", "x-vuurtoren": "1" };

async function api(path, init = {}) {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `The server answered ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function show(which) {
  $("sign-in").hidden = which !== "sign-in";
  $("devices").hidden = which !== "devices";
  $("sign-out").hidden = which !== "devices";
}

function problem(el, text) {
  el.textContent = text || "";
  el.hidden = !text;
}

const when = (ms) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

async function loadDevices() {
  const { tokens } = await api("/api/auth/sync-tokens");
  const list = $("list");
  list.replaceChildren();
  for (const t of tokens) {
    const li = document.createElement("li");
    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = t.label || "A device";
    const meta = document.createElement("span");
    meta.className = "hint";
    meta.textContent = t.lastUsedAt
      ? `Last synced ${when(t.lastUsedAt)}`
      : `Added ${when(t.createdAt)}, not synced yet`;
    text.append(name, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      if (remove.dataset.sure !== "1") {
        remove.dataset.sure = "1";
        remove.textContent = "Remove it?";
        return;
      }
      try {
        await api(`/api/auth/sync-tokens/${encodeURIComponent(t.id)}`, {
          method: "DELETE",
          headers: JSON_HEADERS,
        });
        await loadDevices();
      } catch (e) {
        problem($("error"), e.message);
      }
    });
    li.append(text, remove);
    list.append(li);
  }
  $("empty").hidden = tokens.length > 0;
}

function drawQr(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const m = 4;
  let d = "";
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  const box = n + m * 2;
  $("qr").innerHTML =
    `<svg viewBox="${-m} ${-m} ${box} ${box}" shape-rendering="crispEdges">` +
    `<rect x="${-m}" y="${-m}" width="${box}" height="${box}" fill="#fff"/>` +
    `<path d="${d}" fill="#000"/></svg>`;
}

async function makeCode() {
  problem($("error"), "");
  try {
    const { code, expiresAt } = await api("/api/sync/pair-code", {
      method: "POST",
      headers: JSON_HEADERS,
      body: "{}",
    });
    const server = location.origin;
    const link = `vuurtoren://connect?${new URLSearchParams({ server, code })}`;
    drawQr(link);
    $("code-text").textContent = code;
    $("code-valid").textContent =
      `Works once, until ${new Date(expiresAt).toLocaleTimeString(undefined, { timeStyle: "short" })}.`;
    $("code-link").value = link;
    $("code").hidden = false;
    $("make-code").textContent = "Show a new code";
  } catch (e) {
    problem($("error"), e.message);
  }
}

async function start() {
  try {
    await api("/api/auth/me");
    show("devices");
    await loadDevices();
  } catch (e) {
    if (e.status === 401) show("sign-in");
    else problem($("error"), e.message);
  }
}

$("sign-in-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  problem($("sign-in-error"), "");
  try {
    await api("/api/auth/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ user: $("user").value, password: $("password").value }),
    });
    $("password").value = "";
    await start();
  } catch (e) {
    problem($("sign-in-error"), e.message);
  }
});
$("sign-out").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", headers: JSON_HEADERS }).catch(() => {});
  $("code").hidden = true;
  show("sign-in");
});
$("make-code").addEventListener("click", makeCode);
$("copy-link").addEventListener("click", () => {
  const input = $("code-link");
  input.select();
  navigator.clipboard?.writeText(input.value).catch(() => {});
});

start();
