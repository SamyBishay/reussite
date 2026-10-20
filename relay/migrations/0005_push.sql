-- Push (phase 3b, docs/dev/push.md). A device is known by a random push id of its own, unrelated
-- to any space: the relay cannot tell which space a subscription belongs to. It keeps the push
-- service's endpoint and the notifications waiting to be sent, each already encrypted by the
-- device (RFC 8291) so the relay and the push service see only ciphertext. "Delete everywhere"
-- does not reach these tables (no link to a space); rows expire (45 days without a schedule write).

CREATE TABLE push_devices (
  pid         TEXT PRIMARY KEY,          -- 16 bytes, base64url, chosen by the device
  auth_hash   TEXT NOT NULL,             -- SHA-256 of the push secret, base64url; set by the first write
  endpoint    TEXT NOT NULL,             -- the push service's URL for this subscription (host checked against PUSH_HOSTS)
  created     INTEGER NOT NULL,          -- ms
  updated     INTEGER NOT NULL,          -- ms; last register or schedule write (pruned after 45 days)
  fails       INTEGER NOT NULL DEFAULT 0,-- consecutive sends the push service did not take
  last_status INTEGER,                   -- the push service's last HTTP status
  last_sent   INTEGER                    -- ms of the last send that was taken
);

CREATE TABLE push_items (
  pid     TEXT NOT NULL,
  id      TEXT NOT NULL,                 -- the app's deterministic id, e.g. fixed:<id>:<day>
  at      INTEGER NOT NULL,              -- ms: send from here
  ttl     INTEGER NOT NULL,              -- seconds the push service may still deliver it after `at`
  urgency TEXT NOT NULL DEFAULT 'high',
  blob    TEXT NOT NULL,                 -- base64url aes128gcm payload; never decoded here
  tries   INTEGER NOT NULL DEFAULT 0,    -- failed sends so far (429, 5xx, network)
  PRIMARY KEY (pid, id)
);
CREATE INDEX push_items_at ON push_items (at);
