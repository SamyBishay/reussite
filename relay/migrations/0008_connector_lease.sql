-- The connector's writes survive a killed request (docs/dev/connector.md, "Applying a confirmation once"), and
-- the heavy work leaves the write path for the maintenance cron (docs/dev/connector.md, "Maintenance").

-- A confirmation is claimed with a short lease while it is applied, then marked applied in the same D1 batch
-- that appends the change batch: a killed request leaves the lease to run out, and a retry of an applied id
-- answers with the undo id it had.
ALTER TABLE connector_pending ADD COLUMN claimed_until INTEGER;   -- ms; a lease, null when nobody is applying it
ALTER TABLE connector_pending ADD COLUMN applied_at INTEGER;      -- ms; set in the same batch as the write
ALTER TABLE connector_pending ADD COLUMN undo_id TEXT;            -- the undo record made with it
ALTER TABLE connector_pending ADD COLUMN seq INTEGER;             -- the batch it appended

-- What the maintenance cron picks a space for (one space per run, oldest first).
ALTER TABLE connector ADD COLUMN feed_dirty INTEGER NOT NULL DEFAULT 0;      -- ms of the last write the calendar feed has not followed; 0 when it is up to date
ALTER TABLE connector ADD COLUMN compact_due INTEGER NOT NULL DEFAULT 0;     -- 1 when a call had to read the cold part, so the hot part should be cut again
ALTER TABLE connector ADD COLUMN last_maintained INTEGER NOT NULL DEFAULT 0; -- ms; when the cron last picked the space (set before the work, so a killed run still moves it to the back)
