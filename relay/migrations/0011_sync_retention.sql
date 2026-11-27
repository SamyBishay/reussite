-- The first snapshot to cover a batch starts its retention period.
ALTER TABLE batches ADD COLUMN covered_at INTEGER;
CREATE INDEX batches_covered_at ON batches (covered_at) WHERE covered_at IS NOT NULL;

ALTER TABLE spaces ADD COLUMN batch_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spaces ADD COLUMN batch_count INTEGER NOT NULL DEFAULT 0;
UPDATE spaces
SET (batch_bytes, batch_count) = (
  SELECT COALESCE(SUM(size), 0), COUNT(*) FROM batches WHERE space = spaces.id
);
CREATE TRIGGER batches_count_insert AFTER INSERT ON batches
BEGIN
  UPDATE spaces SET batch_bytes = batch_bytes + NEW.size, batch_count = batch_count + 1 WHERE id = NEW.space;
END;
CREATE TRIGGER batches_count_delete AFTER DELETE ON batches
BEGIN
  UPDATE spaces SET batch_bytes = batch_bytes - OLD.size, batch_count = batch_count - 1 WHERE id = OLD.space;
END;
