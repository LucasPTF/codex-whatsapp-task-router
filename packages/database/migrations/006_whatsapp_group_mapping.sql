ALTER TABLE whatsapp_raw_chats
  ADD COLUMN live_conversation_id TEXT REFERENCES conversations(id);

CREATE UNIQUE INDEX whatsapp_raw_live_conversation
  ON whatsapp_raw_chats(live_conversation_id)
  WHERE live_conversation_id IS NOT NULL;
