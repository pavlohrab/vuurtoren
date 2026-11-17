/**
 * `node dist/main.js hash-password`: print a KENNING_PASSWORD_HASH for a password.
 *
 * On a terminal the password is typed twice without echo; otherwise it is read from stdin
 * (one trailing newline removed), e.g. `printf %s "$PW" | node dist/main.js hash-password`.
 * Docker: `docker compose run --rm -it api hash-password`.
 */
import { hashPassword } from "./password.js";

/** Read one line from a TTY with echo off. Ctrl-C aborts. */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (err?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (buf: Buffer): void => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done();
        if (ch === "\u0003") return done(new Error("Cancelled."));
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else if (ch >= " ") value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

/** Run the command; returns the process exit code. */
export async function hashPasswordCommand(): Promise<number> {
  let password: string;
  if (process.stdin.isTTY) {
    password = await readHidden("New password: ");
    const again = await readHidden("Repeat it:    ");
    if (password !== again) {
      process.stderr.write("The two passwords differ. Nothing was printed.\n");
      return 1;
    }
  } else {
    password = await readAllStdin();
  }
  if (password.length < 8) {
    process.stderr.write("Use at least 8 characters (a long passphrase is best).\n");
    return 1;
  }
  if (password.length < 12) {
    process.stderr.write("Note: a passphrase of 12+ characters is much safer on the internet.\n");
  }
  const hash = await hashPassword(password);
  process.stdout.write(`${hash}\n`);
  process.stderr.write(
    "\nPut this in your .env (single quotes are not needed; the hash contains no $):\n" +
      `  KENNING_PASSWORD_HASH=${hash}\n`,
  );
  return 0;
}
