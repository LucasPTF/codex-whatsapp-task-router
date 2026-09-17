ALTER TABLE whatsapp_raw_messages
  ADD COLUMN sync_run_id TEXT REFERENCES whatsapp_sync_runs(id);

CREATE INDEX whatsapp_raw_messages_sync_run
  ON whatsapp_raw_messages(sync_run_id,account_id,conversation_id);

CREATE TABLE analysis_proposals_with_traffic(
  id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id),
  request_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('copy','design','page','strategy','service','traffic')),
  priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
  due_at TEXT,
  evidence_ids TEXT NOT NULL,
  needs_review INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  task_id TEXT REFERENCES tasks(id),
  reviewed_by TEXT REFERENCES employees(id),
  reviewed_at TEXT,
  UNIQUE(analysis_run_id,request_key)
);

INSERT INTO analysis_proposals_with_traffic
SELECT * FROM analysis_proposals;

DROP TABLE analysis_proposals;
ALTER TABLE analysis_proposals_with_traffic RENAME TO analysis_proposals;

CREATE INDEX analysis_proposals_run_status
  ON analysis_proposals(analysis_run_id,status);

CREATE TABLE whatsapp_analysis_batches(
  id TEXT PRIMARY KEY,
  sync_run_id TEXT NOT NULL REFERENCES whatsapp_sync_runs(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  chunk_index INTEGER NOT NULL,
  new_message_ids TEXT NOT NULL,
  new_message_count INTEGER NOT NULL CHECK(new_message_count > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','succeeded','needs_review','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  analysis_run_id TEXT REFERENCES analysis_runs(id),
  error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(sync_run_id,project_id,chunk_index)
);

CREATE INDEX whatsapp_analysis_batches_queue
  ON whatsapp_analysis_batches(status,created_at,id);

CREATE INDEX whatsapp_analysis_batches_project
  ON whatsapp_analysis_batches(project_id,created_at DESC);
