CREATE TABLE user_sessions(
  token_hash TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX user_sessions_employee ON user_sessions(employee_id,revoked_at,expires_at);
