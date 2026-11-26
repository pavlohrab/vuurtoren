/**
 * The feedback Worker at issue.vuurtoren.app (FB1). The app sends a report (text, a voice note,
 * a screenshot, device facts); it is stored (D1; the files in R2 when a bucket is bound) and sent to Pavlo's Telegram with two
 * buttons. "Make issue" turns it into a GitHub issue, "Done" closes it. Pavlo's reply to the
 * message goes back to the tester's app, when they agreed to that.
 *
 *   POST /v1/report            multipart: report (JSON), screenshot?, voice?   (x-vuurtoren-key)
 *   GET  /v1/replies?to=<id>   Pavlo's replies for this device, once each      (x-vuurtoren-key)
 *   POST /v1/contact           the website's contact form (vuurtoren.app only, no key)
 *   POST /tg/hook              Telegram's webhook (X-Telegram-Bot-Api-Secret-Token)
 *   cron                       reports older than 90 days are deleted
 */
import {
  CONTACT_ORIGINS,
  LIMITS,
  contactMessage,
  readContact,
  addressHash,
  hasContent,
  issueBody,
  issueLabels,
  issueTitle,
  message,
  readReport,
  type Report,
} from "./logic.js";

// The few Cloudflare types used here (no @cloudflare/workers-types needed).
interface D1Result<T> {
  results: T[];
}
interface D1Statement {
  bind(...v: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1Statement;
}
interface R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface R2Bucket {
  put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
}
interface Ai {
  run(model: string, input: unknown): Promise<{ text?: string }>;
}

export interface Env {
  DB: D1Database;
  /** Optional: keeps the files too. Without it they live only in Pavlo's Telegram chat. */
  FILES?: R2Bucket;
  AI?: Ai;
  /** The key built into the app; change it if someone abuses the endpoint. */
  APP_KEY: string;
  TG_TOKEN: string;
  /** Pavlo's chat with the bot: only it is answered. */
  TG_CHAT_ID: string;
  /** The webhook's secret token (setWebhook secret_token). */
  TG_SECRET: string;
  /** A fine-grained token that can only make issues in the repo. */
  GITHUB_TOKEN: string;
  /** "pavlohrab/Vuurtoren" */
  GITHUB_REPO: string;
  /** For the hourly limit's address hash. */
  SALT: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-vuurtoren-key",
  "access-control-max-age": "86400",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === "/tg/hook" && req.method === "POST") return await telegram(req, env);
      if (url.pathname === "/v1/contact") return await contact(req, env);
      if (req.headers.get("x-vuurtoren-key") !== env.APP_KEY)
        return json(401, { error: "This version of Vuurtoren can't send feedback. Update it." });
      if (url.pathname === "/v1/report" && req.method === "POST") return await report(req, env);
      if (url.pathname === "/v1/replies" && req.method === "GET") return await replies(url, env);
      return json(404, { error: "Not here." });
    } catch (e) {
      console.error(e);
      return json(500, { error: "Something went wrong. Try again later." });
    }
  },

  /**
   * Hourly: reports Telegram refused are sent again; reports and contact messages older than
   * 90 days go, with their files.
   */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const unsent = await env.DB.prepare(
      "SELECT id, body, transcript FROM reports WHERE status = 'unsent' ORDER BY created LIMIT 20",
    ).all<{ id: string; body: string; transcript: string | null }>();
    for (const u of unsent.results) {
      const shot = await env.FILES?.get(`${u.id}/screenshot`);
      const voice = await env.FILES?.get(`${u.id}/voice`);
      const messageId = await sendToPavlo(
        env,
        JSON.parse(u.body) as Report,
        u.transcript,
        shot ? await shot.arrayBuffer() : null,
        "image/jpeg",
        voice ? await voice.arrayBuffer() : null,
        "audio/webm",
      );
      if (messageId)
        await env.DB.prepare("UPDATE reports SET tg_message = ?, status = 'new' WHERE id = ?")
          .bind(messageId, u.id)
          .run();
    }
    const before = Date.now() - 90 * 86_400_000;
    const old = await env.DB.prepare("SELECT id FROM reports WHERE created < ?")
      .bind(before)
      .all<{ id: string }>();
    if (env.FILES)
      for (const { id } of old.results) await env.FILES.delete([`${id}/screenshot`, `${id}/voice`]);
    await env.DB.prepare("DELETE FROM replies WHERE report_id IN (SELECT id FROM reports WHERE created < ?)")
      .bind(before)
      .run();
    await env.DB.prepare("DELETE FROM reports WHERE created < ?").bind(before).run();
    await env.DB.prepare("DELETE FROM contacts WHERE created < ?").bind(before).run();
  },
};

async function report(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const read = readReport(JSON.parse(String(form.get("report") ?? "null")));
  if ("error" in read) return json(400, { error: read.error });
  const r = read.report;
  const screenshot = form.get("screenshot");
  const voice = form.get("voice");
  const shot = screenshot instanceof File && screenshot.size > 0 ? screenshot : null;
  const audio = voice instanceof File && voice.size > 0 ? voice : null;
  if (shot && shot.size > LIMITS.screenshotBytes) return json(413, { error: "The picture is too big." });
  if (audio && audio.size > LIMITS.voiceBytes) return json(413, { error: "The voice note is too long." });
  if (!hasContent(r, { screenshot: !!shot, voice: !!audio }))
    return json(400, { error: "Say what went wrong first." });

  // Sent twice (offline, then online): stored once.
  if (await env.DB.prepare("SELECT id FROM reports WHERE id = ?").bind(r.id).first())
    return json(200, { ok: true, id: r.id });

  const ip = await addressHash(req.headers.get("cf-connecting-ip") ?? "", env.SALT);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE ip = ? AND created > ?")
    .bind(ip, Date.now() - 3_600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= LIMITS.perHour)
    return json(429, { error: "That's a lot of feedback in one hour. Try again later." });

  const shotBytes = shot ? await shot.arrayBuffer() : null;
  const audioBytes = audio ? await audio.arrayBuffer() : null;
  if (shotBytes && env.FILES)
    await env.FILES.put(`${r.id}/screenshot`, shotBytes, { httpMetadata: { contentType: shot!.type } });
  if (audioBytes && env.FILES)
    await env.FILES.put(`${r.id}/voice`, audioBytes, { httpMetadata: { contentType: audio!.type } });
  const transcript = audioBytes ? await transcribe(env, audioBytes) : null;

  await env.DB.prepare(
    "INSERT INTO reports (id, created, ip, body, transcript, status, reply_to) VALUES (?, ?, ?, ?, ?, 'new', ?)",
  )
    .bind(r.id, Date.now(), ip, JSON.stringify(r), transcript, r.replyTo ?? null)
    .run();

  const messageId = await sendToPavlo(env, r, transcript, shotBytes, shot?.type, audioBytes, audio?.type);
  // Telegram said no (an outage, a limit): the report stays "unsent" and the hourly job tries again.
  await env.DB.prepare("UPDATE reports SET tg_message = ?, status = ? WHERE id = ?")
    .bind(messageId, messageId ? "new" : "unsent", r.id)
    .run();
  return json(200, { ok: true, id: r.id });
}

/** Workers AI Whisper; null when it isn't bound or fails (the audio still goes to Pavlo). */
async function transcribe(env: Env, audio: ArrayBuffer): Promise<string | null> {
  if (!env.AI) return null;
  try {
    const out = await env.AI.run("@cf/openai/whisper", { audio: [...new Uint8Array(audio)] });
    return out.text?.trim() || null;
  } catch {
    return null;
  }
}

async function tg(env: Env, method: string, body: FormData | Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
    method: "POST",
    ...(body instanceof FormData
      ? { body }
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  return (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number } };
}

const buttons = (id: string) => ({
  inline_keyboard: [
    [
      { text: "Make issue", callback_data: `issue:${id}` },
      { text: "Done", callback_data: `done:${id}` },
    ],
  ],
});

/** The message with the picture (or without), then the voice note under it. */
async function sendToPavlo(
  env: Env,
  r: Report,
  transcript: string | null,
  shot: ArrayBuffer | null,
  shotType: string | undefined,
  audio: ArrayBuffer | null,
  audioType: string | undefined,
): Promise<number | null> {
  const text = message(r, transcript);
  let sent;
  if (shot) {
    const f = new FormData();
    f.set("chat_id", env.TG_CHAT_ID);
    f.set("caption", text);
    f.set("reply_markup", JSON.stringify(buttons(r.id)));
    f.set("photo", new Blob([shot], { type: shotType ?? "image/png" }), "screen.png");
    sent = await tg(env, "sendPhoto", f);
    // The picture refused (its size, a limit): the words still go, without it.
    if (!sent.ok)
      sent = await tg(env, "sendMessage", {
        chat_id: env.TG_CHAT_ID,
        text: `${text}\n\n(The picture couldn't be sent.)`.slice(0, 4096),
        reply_markup: buttons(r.id),
      });
  } else {
    sent = await tg(env, "sendMessage", { chat_id: env.TG_CHAT_ID, text, reply_markup: buttons(r.id) });
  }
  const id = sent.ok ? (sent.result?.message_id ?? null) : null;
  if (audio) {
    // Telegram plays OGG/Opus as a voice message and M4A/MP3 as audio; anything else (WebM)
    // only as a file. The recording is in R2 either way.
    const type = (audioType ?? "audio/webm").split(";")[0]!.trim();
    const [method, field, name] =
      type === "audio/ogg"
        ? (["sendVoice", "voice", "voice.ogg"] as const)
        : type === "audio/mp4" || type === "audio/x-m4a" || type === "audio/mpeg"
          ? (["sendAudio", "audio", type === "audio/mpeg" ? "voice.mp3" : "voice.m4a"] as const)
          : (["sendDocument", "document", "voice.webm"] as const);
    const f = new FormData();
    f.set("chat_id", env.TG_CHAT_ID);
    if (id) f.set("reply_to_message_id", String(id));
    f.set(field, new Blob([audio], { type }), name);
    const voiceSent = await tg(env, method, f);
    // Refused: say so, instead of a report that looks like it had no voice note.
    if (!voiceSent.ok)
      await tg(env, "sendMessage", {
        chat_id: env.TG_CHAT_ID,
        ...(id ? { reply_to_message_id: id } : {}),
        text: `The voice note couldn't be attached (${(voiceSent as { description?: string }).description ?? "Telegram said no"}). It's kept with the report.`,
      });
  }
  return id;
}

interface TgUpdate {
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    reply_to_message?: { message_id: number };
  };
}

async function telegram(req: Request, env: Env): Promise<Response> {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== env.TG_SECRET)
    return new Response("no", { status: 401 });
  const u = (await req.json()) as TgUpdate;
  const ok = new Response("ok");

  const cb = u.callback_query;
  if (cb?.data && String(cb.message?.chat.id) === env.TG_CHAT_ID) {
    const [what, id] = cb.data.split(":");
    const row = await env.DB.prepare("SELECT body, transcript, issue FROM reports WHERE id = ?")
      .bind(id)
      .first<{ body: string; transcript: string | null; issue: string | null }>();
    if (!row) {
      await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "That report is gone." });
      return ok;
    }
    if (what === "issue") {
      const url = row.issue ?? (await makeIssue(env, JSON.parse(row.body) as Report, row.transcript));
      if (!url) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "GitHub said no. Check the token." });
        return ok;
      }
      await env.DB.prepare("UPDATE reports SET issue = ?, status = 'issue' WHERE id = ?").bind(url, id).run();
      await tg(env, "editMessageReplyMarkup", {
        chat_id: env.TG_CHAT_ID,
        message_id: cb.message!.message_id,
        reply_markup: { inline_keyboard: [[{ text: `Issue ${url.split("/").pop()}`, url }, { text: "Done", callback_data: `done:${id}` }]] },
      });
      await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "Issue made." });
    } else if (what === "done") {
      await env.DB.prepare("UPDATE reports SET status = 'done' WHERE id = ?").bind(id).run();
      const keep = row.issue ? [[{ text: `Issue ${row.issue.split("/").pop()}`, url: row.issue }]] : [];
      await tg(env, "editMessageReplyMarkup", {
        chat_id: env.TG_CHAT_ID,
        message_id: cb.message!.message_id,
        reply_markup: { inline_keyboard: keep },
      });
      await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "Done." });
    }
    return ok;
  }

  // Pavlo replies to a report's message: it goes to the tester's app.
  const m = u.message;
  if (m?.text && m.reply_to_message && String(m.chat.id) === env.TG_CHAT_ID) {
    const row = await env.DB.prepare("SELECT id, reply_to FROM reports WHERE tg_message = ?")
      .bind(m.reply_to_message.message_id)
      .first<{ id: string; reply_to: string | null }>();
    if (row?.reply_to) {
      await env.DB.prepare("INSERT INTO replies (report_id, reply_to, text, created) VALUES (?, ?, ?, ?)")
        .bind(row.id, row.reply_to, m.text.slice(0, 2000), Date.now())
        .run();
      await tg(env, "sendMessage", { chat_id: env.TG_CHAT_ID, reply_to_message_id: m.message_id, text: "Sent to the tester's app." });
    } else if (row) {
      await tg(env, "sendMessage", { chat_id: env.TG_CHAT_ID, reply_to_message_id: m.message_id, text: "This tester didn't ask for replies." });
    }
  }
  return ok;
}

async function makeIssue(env: Env, r: Report, transcript: string | null): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "vuurtoren-feedback",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: issueTitle(r, transcript), body: issueBody(r, transcript), labels: issueLabels(r) }),
  });
  if (!res.ok) return null;
  const out = (await res.json()) as { html_url?: string };
  return out.html_url ?? null;
}

async function replies(url: URL, env: Env): Promise<Response> {
  const to = url.searchParams.get("to") ?? "";
  if (!/^[a-z0-9-]{8,64}$/i.test(to)) return json(400, { error: "No device." });
  const rows = await env.DB.prepare(
    "SELECT id, report_id, text, created FROM replies WHERE reply_to = ? AND delivered IS NULL ORDER BY created",
  )
    .bind(to)
    .all<{ id: number; report_id: string; text: string; created: number }>();
  // Only the replies read here: one that came in meanwhile waits for the next ask.
  const ids = rows.results.map((r) => r.id);
  if (ids.length)
    await env.DB.prepare(`UPDATE replies SET delivered = ? WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(Date.now(), ...ids)
      .run();
  return json(200, {
    replies: rows.results.map((r) => ({ report: r.report_id, text: r.text, at: r.created })),
  });
}

/** The website's contact form: to Pavlo's Telegram, kept in D1; 5 an hour per address. */
async function contact(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = CONTACT_ORIGINS.includes(origin);
  const cors = {
    "access-control-allow-origin": allowed ? origin : CONTACT_ORIGINS[0]!,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...cors },
    });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return answer(405, { error: "Not here." });
  if (!allowed) return answer(403, { error: "Send it from vuurtoren.app." });
  const read = readContact(await req.json().catch(() => null));
  if ("bot" in read) return answer(200, { ok: true });
  if ("error" in read) return answer(400, { error: read.error });
  const ip = await addressHash(req.headers.get("cf-connecting-ip") ?? "", env.SALT);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE ip = ? AND created > ?")
    .bind(ip, Date.now() - 3_600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5)
    return answer(429, { error: "That's a lot of messages in one hour. Try again later." });
  const c = read.contact;
  await env.DB.prepare("INSERT INTO contacts (created, ip, name, email, message) VALUES (?, ?, ?, ?, ?)")
    .bind(Date.now(), ip, c.name, c.email, c.message)
    .run();
  await tg(env, "sendMessage", { chat_id: env.TG_CHAT_ID, text: contactMessage(c) });
  return answer(200, { ok: true });
}
