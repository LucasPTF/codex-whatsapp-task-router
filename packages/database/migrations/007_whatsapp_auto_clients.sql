ALTER TABLE whatsapp_raw_chats
  ADD COLUMN mapping_state TEXT NOT NULL DEFAULT 'pending'
  CHECK(mapping_state IN ('pending','mapped','ignored'));

ALTER TABLE whatsapp_raw_chats
  ADD COLUMN mapping_method TEXT
  CHECK(mapping_method IN ('manual','automatic'));

UPDATE whatsapp_raw_chats
SET mapping_state='mapped',mapping_method='manual'
WHERE project_id IS NOT NULL;

CREATE INDEX whatsapp_raw_mapping_queue
  ON whatsapp_raw_chats(account_id,is_group,mapping_state,title COLLATE NOCASE);
