-- Snapshots in two parts (docs/dev/sync.md, "Hot and cold"). A space's snapshot is now a set of
-- rows by `kind`: 'full' (one whole snapshot, as every snapshot was until now), or 'hot' and 'cold'
-- (two separately encrypted blobs; the connector reads only the hot one for most questions).
-- Each kind is cut into parts of at most 1 MB because a D1 row holds 2 MB. The relay never opens
-- any of them. Existing rows become kind 'full', so nothing is lost and old snapshots stay readable.
-- Same table name, so SPACE_TABLES (src/sync.ts) is unchanged.

CREATE TABLE snapshots_new (
  space TEXT NOT NULL,
  kind  TEXT NOT NULL DEFAULT 'full',    -- 'full' | 'hot' | 'cold'
  part  INTEGER NOT NULL,
  upto  INTEGER NOT NULL,                -- covers every batch with seq <= upto
  blob  TEXT NOT NULL,
  size  INTEGER NOT NULL,                -- bytes of the whole decoded blob (same on every part)
  at    INTEGER NOT NULL,
  PRIMARY KEY (space, kind, part)
);
INSERT INTO snapshots_new (space, kind, part, upto, blob, size, at) SELECT space, 'full', part, upto, blob, size, at FROM snapshots;
DROP TABLE snapshots;
ALTER TABLE snapshots_new RENAME TO snapshots;
