-- One feed per list (docs/dev/feed.md, 27 Oct 2026): a feed a device made for itself before feeds were
-- shared points at the list's feed, so a calendar subscribed to the old address keeps showing the current
-- one. An alias row keeps its id and secret and no text; it lives as long as the feed it points at.
ALTER TABLE feeds ADD COLUMN alias TEXT;
CREATE INDEX feeds_alias ON feeds (alias);
