-- Mark token rows written by the canonical-list write-through cache
-- (token-list.service writeThroughD1) so readD1Cache serves only canonical
-- rows: user-curated rows upserted via token.service (is_verified = 1) must
-- never be served as canonical-list fallback content. Existing rows default
-- to 'user' and are re-claimed as 'token-list' by the next successful list
-- refresh (writeThroughD1's ON CONFLICT sets source = excluded.source).
ALTER TABLE tokens ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
