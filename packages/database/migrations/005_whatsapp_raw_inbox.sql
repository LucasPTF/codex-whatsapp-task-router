CREATE TABLE whatsapp_raw_chats(
  account_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  is_group INTEGER NOT NULL CHECK(is_group IN (0,1)),
  first_captured_at TEXT NOT NULL,
  last_captured_at TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  PRIMARY KEY(account_id,conversation_id)
);
CREATE INDEX whatsapp_raw_chats_project
  ON whatsapp_raw_chats(project_id,last_captured_at DESC);

CREATE TABLE whatsapp_raw_messages(
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('incoming','outgoing')),
  text TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  message_type TEXT NOT NULL,
  has_media INTEGER NOT NULL CHECK(has_media IN (0,1)),
  FOREIGN KEY(account_id,conversation_id)
    REFERENCES whatsapp_raw_chats(account_id,conversation_id),
  UNIQUE(account_id,conversation_id,external_id)
);
CREATE INDEX whatsapp_raw_messages_chat_sent
  ON whatsapp_raw_messages(account_id,conversation_id,sent_at DESC);
