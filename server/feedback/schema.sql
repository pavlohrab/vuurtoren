-- The feedback Worker's tables (D1). Apply with:
--   npx wrangler d1 execute vuurtoren-feedback --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,           -- made by the app
  created INTEGER NOT NULL,      -- ms
  ip TEXT NOT NULL,              -- a salted hash, for the hourly limit
  body TEXT NOT NULL,            -- the report, JSON
  transcript TEXT,               -- the voice note as text (Workers AI Whisper)
  status TEXT NOT NULL,          -- new | unsent (Telegram refused) | issue | done
  issue TEXT,                    -- the GitHub issue's address
  tg_message INTEGER,            -- Pavlo's Telegram message, for replies
  reply_to TEXT                  -- the tester's device id for replies, or null
);
CREATE INDEX IF NOT EXISTS reports_ip ON reports (ip, created);
CREATE INDEX IF NOT EXISTS reports_tg ON reports (tg_message);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  text TEXT NOT NULL,
  created INTEGER NOT NULL,
  delivered INTEGER              -- when the app took it
);
CREATE INDEX IF NOT EXISTS replies_to ON replies (reply_to, delivered);

-- The website's contact form (about.html).
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created INTEGER NOT NULL,
  ip TEXT NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contacts_ip ON contacts (ip, created);

-- One tester per device (FB2): their name and their topic in Pavlo's Telegram group.
CREATE TABLE IF NOT EXISTS testers (
  device TEXT PRIMARY KEY,
  name TEXT,
  topic INTEGER,                 -- message_thread_id, or null in a chat without topics
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS testers_topic ON testers (topic);
