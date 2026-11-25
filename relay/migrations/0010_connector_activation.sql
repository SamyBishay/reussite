-- Each switching on of the connector is an activation with its own id (docs/dev/connector.md, "Activations"). A grant
-- carries the id it was paired under, and a call or a write is accepted only while the row still has that id: a grant
-- left over from an earlier activation (KV is eventually consistent and revocation can be interrupted) is refused
-- even when OAuth storage still knows it. Rows that exist when this is applied are 'legacy', which is also what a grant
-- made before ids existed is read as, so nobody has to pair again at rollout; the next switch-off and on ends them.
ALTER TABLE connector ADD COLUMN activation TEXT NOT NULL DEFAULT 'legacy';
