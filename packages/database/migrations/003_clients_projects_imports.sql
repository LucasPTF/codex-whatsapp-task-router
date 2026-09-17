CREATE TABLE clients(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX clients_name_active ON clients(name COLLATE NOCASE) WHERE active=1;

ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id);
ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN created_at TEXT;
ALTER TABLE projects ADD COLUMN updated_at TEXT;
CREATE INDEX projects_client ON projects(client_id,active);

CREATE TABLE project_briefs(
  project_id TEXT NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  offer TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  restrictions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES employees(id),
  PRIMARY KEY(project_id,version)
);
CREATE TABLE conversations(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('whatsapp_export','live')),
  content_hash TEXT,
  captured_from TEXT,
  captured_through TEXT,
  imported_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX conversations_project ON conversations(project_id,created_at);

CREATE TABLE participants(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('client','team','unknown')),
  created_at TEXT NOT NULL,
  UNIQUE(project_id,display_name)
);

CREATE TABLE import_batches(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  skipped_lines INTEGER NOT NULL,
  utc_offset TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  imported_by TEXT NOT NULL REFERENCES employees(id),
  UNIQUE(project_id,content_hash)
);
