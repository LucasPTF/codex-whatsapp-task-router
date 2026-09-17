ALTER TABLE whatsapp_raw_messages ADD COLUMN sender_name TEXT;

CREATE TABLE whatsapp_team_identities(
  account_id TEXT NOT NULL,
  match_kind TEXT NOT NULL CHECK(match_kind IN ('phone','name')),
  match_value TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(account_id,match_kind,match_value)
);

CREATE INDEX whatsapp_team_identity_employee
  ON whatsapp_team_identities(employee_id,account_id);
