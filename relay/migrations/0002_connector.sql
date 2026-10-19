-- The connector (brief §10): a remote MCP server for AI apps. While it is on, the relay holds the
-- space's key, wrapped with the CONNECTOR_WRAP_KEY secret. Every table here is listed in
-- SPACE_TABLES (src/sync.ts), so "delete everywhere" and switching the connector off clear them.

CREATE TABLE connector (
  space       TEXT PRIMARY KEY,
  wrapped     TEXT NOT NULL,              -- base64url [IV][AES-GCM] of {k: encryption key, a: auth secret}; key = CONNECTOR_WRAP_KEY
  created     INTEGER NOT NULL,           -- ms
  last_used   INTEGER,                    -- ms; every call updates it
  hlc_wall    INTEGER NOT NULL DEFAULT 0, -- the connector's own clock for this space (node "connector"), kept between calls
  hlc_counter INTEGER NOT NULL DEFAULT 0
);

-- Pairing codes: single use, 10 minutes, stored as a keyed hash (HMAC with the wrap key), never the code.
CREATE TABLE connector_codes (
  code_hash TEXT PRIMARY KEY,
  space     TEXT NOT NULL,
  expires   INTEGER NOT NULL              -- ms
);
CREATE INDEX connector_codes_space ON connector_codes (space);

-- A change-set shown to the person and waiting for their yes (one hour). Encrypted with the space key.
CREATE TABLE connector_pending (
  id      TEXT PRIMARY KEY,
  space   TEXT NOT NULL,
  blob    TEXT NOT NULL,
  expires INTEGER NOT NULL                -- ms
);
CREATE INDEX connector_pending_space ON connector_pending (space);

-- What an applied change-set replaced, so `undo` can put it back. Encrypted with the space key.
CREATE TABLE connector_undo (
  id    TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  blob  TEXT NOT NULL,
  at    INTEGER NOT NULL                  -- ms
);
CREATE INDEX connector_undo_space ON connector_undo (space);
