-- When a feed address was last fetched, and by what kind of calendar app (10 Nov 2026). A calendar that
-- still subscribes to an old address can only be found if fetches are remembered; until now only writes were
-- (`updated`). `fetched` is ms, written at most once every FETCH_LOG_MS per address; `fetched_by` is a coarse
-- name ("Google Calendar", "Apple Calendar", "a browser"), never the full user agent and never an IP.
ALTER TABLE feeds ADD COLUMN fetched INTEGER;
ALTER TABLE feeds ADD COLUMN fetched_by TEXT;
