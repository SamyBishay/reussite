-- Sync (brief §6). The relay stores opaque blobs: base64url text it never decodes.
-- Later tables (connector, push) go in their own migrations; the connector's per-space
-- rows should be deleted by deleteSpaceData in src/sync.ts.

CREATE TABLE spaces (
  id         TEXT PRIMARY KEY,           -- 16 bytes, base64url (derived from the key)
  auth_hash  TEXT NOT NULL,              -- SHA-256 of the auth secret, base64url; set by the first write
  created    INTEGER NOT NULL,           -- ms
  last_write INTEGER NOT NULL,           -- ms
  head       INTEGER NOT NULL DEFAULT 0, -- the last seq handed out; never goes down, even after pruning
  win        INTEGER NOT NULL DEFAULT 0, -- rate limit: the minute (ms / 60000) being counted
  n          INTEGER NOT NULL DEFAULT 0  -- rate limit: writes in that minute
);

CREATE TABLE batches (
  space  TEXT NOT NULL,
  seq    INTEGER NOT NULL,               -- increasing per space
  device TEXT NOT NULL,
  blob   TEXT NOT NULL,
  size   INTEGER NOT NULL,               -- bytes of the decoded blob
  at     INTEGER NOT NULL,               -- ms
  PRIMARY KEY (space, seq)
);

-- One snapshot per space, cut into parts because a D1 row holds at most 2 MB.
CREATE TABLE snapshots (
  space TEXT NOT NULL,
  part  INTEGER NOT NULL,
  upto  INTEGER NOT NULL,                -- covers every batch with seq <= upto
  blob  TEXT NOT NULL,
  size  INTEGER NOT NULL,                -- bytes of the whole decoded blob (same on every part)
  at    INTEGER NOT NULL,
  PRIMARY KEY (space, part)
);

CREATE TABLE devices (
  space      TEXT NOT NULL,
  device     TEXT NOT NULL,
  label_blob TEXT,                       -- encrypted { name }
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (space, device)
);

-- Per-IP counters, one row per key and minute; only writes and failed sign-ins are counted.
CREATE TABLE rate (
  key TEXT NOT NULL,
  win INTEGER NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);
CREATE INDEX rate_win ON rate (win);
