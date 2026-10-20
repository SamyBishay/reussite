-- The inbox (brief §10, "The one-tap link"): change-sets left for the person by the drop page,
-- encrypted to the space's inbox public key. Anyone with the drop address may add one (no auth),
-- so it is capped in size, in number and in rate; only the owner (Bearer) can read or delete.
-- Listed in SPACE_TABLES (src/sync.ts), so "delete everywhere" clears it.

CREATE TABLE inbox (
  id    TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  blob  TEXT NOT NULL,                   -- base64url sealed box; never decoded here
  at    INTEGER NOT NULL                 -- ms; kept 30 days
);
CREATE INDEX inbox_space ON inbox (space, at);
