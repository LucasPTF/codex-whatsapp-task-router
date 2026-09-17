CREATE TABLE analysis_runs(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','stale','cancelled')),
  requested_by TEXT NOT NULL REFERENCES employees(id),
  skill_id TEXT NOT NULL,
  skill_hash TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  model TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  total_message_count INTEGER NOT NULL,
  included_message_count INTEGER NOT NULL,
  summary TEXT,
  output_hash TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE UNIQUE INDEX analysis_one_running_per_project
  ON analysis_runs(project_id) WHERE status='running';
CREATE INDEX analysis_runs_project_created
  ON analysis_runs(project_id,created_at DESC);

CREATE TABLE analysis_proposals(
  id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id),
  request_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('copy','design','page','strategy','service')),
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
CREATE INDEX analysis_proposals_run_status
  ON analysis_proposals(analysis_run_id,status);
