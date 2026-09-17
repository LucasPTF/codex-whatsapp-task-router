CREATE TABLE whatsapp_sync_runs(
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('initial','incremental')),
  requested_from TEXT NOT NULL,
  requested_through TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT
);
CREATE INDEX whatsapp_sync_runs_account_started
  ON whatsapp_sync_runs(account_id,started_at DESC);

CREATE TABLE whatsapp_sync_checkpoints(
  account_id TEXT PRIMARY KEY,
  synced_through TEXT NOT NULL,
  last_successful_run_at TEXT NOT NULL
);
