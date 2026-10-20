-- The calendar feed (phase 3b, docs/dev/feed.md). A device uploads finished calendar text and
-- the relay serves it, unauthenticated, at /cal/<fid>.ics; the fid (192 random bits) is the only
-- thing that keeps it private. It has no link to a space, so "Delete everywhere" does not reach
-- it; the device deletes its own feed when the feed is switched off or regenerated.

CREATE TABLE feeds (
  fid       TEXT PRIMARY KEY,   -- 24 random bytes, base64url, chosen by the device
  auth_hash TEXT NOT NULL,      -- SHA-256 of the write secret, base64url; set by the first write
  ics       TEXT NOT NULL,      -- the calendar text, at most 256 KB
  updated   INTEGER NOT NULL    -- ms; last write
);
