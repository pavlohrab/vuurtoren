/**
 * Auth settings from the environment:
 *
 *   KENNING_USER            username for password sign-in
 *   KENNING_PASSWORD_HASH   scrypt hash from `hash-password` (recommended)
 *   KENNING_PASSWORD        plain password (accepted, hashed at startup; a warning is logged)
 *   KENNING_TOKEN           bearer token for scripts / the MCP server
 *   KENNING_AUTH_DB         session database (default auth.sqlite next to KENNING_DB, i.e.
 *                           /data/auth.sqlite in Docker; in memory while auth is off)
 *   KENNING_COOKIE_SECURE   "0" to drop the Secure cookie flag (plain-http LAN only)
 *   KENNING_TRUST_CF        "1" behind a Cloudflare Tunnel: client IP from CF-Connecting-IP
 *   KENNING_ALLOWED_ORIGINS extra origins (comma-separated) for state-changing requests
 *
 * With no password and no token, auth is off.
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { AuthOptions } from "./index.js";
import { DEFAULT_SCRYPT, hashPasswordWithSalt, parsePasswordHash } from "./password.js";

const flag = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined || v.trim() === "") return fallback;
  return !/^(0|false|no|off)$/i.test(v.trim());
};

/** Build `AuthOptions` and a list of log lines describing the result. Throws on bad config. */
export async function authFromEnv(
  env: NodeJS.ProcessEnv,
): Promise<{ options: AuthOptions; log: string[]; warnings: string[] }> {
  const log: string[] = [];
  const warnings: string[] = [];
  const user = env["KENNING_USER"]?.trim() || undefined;
  const hashText = env["KENNING_PASSWORD_HASH"]?.trim() || undefined;
  const plain = env["KENNING_PASSWORD"] || undefined;
  const token = env["KENNING_TOKEN"]?.trim() || undefined;

  let password;
  if (hashText) {
    password = parsePasswordHash(hashText);
    if (plain) warnings.push("KENNING_PASSWORD is ignored because KENNING_PASSWORD_HASH is set.");
  } else if (plain) {
    // A salt derived from the username keeps the hash (and so the sessions) stable across
    // restarts. Fine for this fallback; `hash-password` uses a random salt.
    const salt = createHash("sha256")
      .update(`kenning-plain-password\0${user ?? ""}`)
      .digest();
    password = parsePasswordHash(
      await hashPasswordWithSalt(plain, salt.subarray(0, 16), DEFAULT_SCRYPT),
    );
    warnings.push(
      "KENNING_PASSWORD is a plain-text password in the environment. Prefer KENNING_PASSWORD_HASH (create one with `hash-password`).",
    );
  }
  if (password && !user) {
    throw new Error("KENNING_USER must be set together with KENNING_PASSWORD_HASH.");
  }
  if (token && token.length < 16) {
    warnings.push(
      "KENNING_TOKEN is short; use at least 32 random characters (openssl rand -hex 32).",
    );
  }

  const cookieSecure = flag(env["KENNING_COOKIE_SECURE"], true);
  const trustCloudflare = flag(env["KENNING_TRUST_CF"], false);
  const allowedOrigins = (env["KENNING_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!password && !token) {
    warnings.push(
      "Auth is OFF: anyone who can reach this server has all the data. Fine for localhost; set KENNING_USER and KENNING_PASSWORD_HASH before exposing it.",
    );
  } else {
    log.push(
      `auth on: ${[password ? `password (user "${user}")` : null, token ? "bearer token" : null]
        .filter(Boolean)
        .join(" + ")}`,
    );
    if (!cookieSecure)
      warnings.push("KENNING_COOKIE_SECURE=0: the session cookie also travels over plain http.");
    if (trustCloudflare) log.push("client IP taken from CF-Connecting-IP (KENNING_TRUST_CF=1)");
  }

  return {
    options: {
      user,
      password,
      token,
      sessionDb:
        password || token
          ? env["KENNING_AUTH_DB"] ||
            join(dirname(env["KENNING_DB"] || "/data/kenning.sqlite"), "auth.sqlite")
          : ":memory:",
      cookieSecure,
      trustCloudflare,
      allowedOrigins,
    },
    log,
    warnings,
  };
}
