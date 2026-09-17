UPDATE whatsapp_raw_chats
SET title=(SELECT p.name FROM projects p WHERE p.id=whatsapp_raw_chats.project_id)
WHERE project_id IS NOT NULL
  AND title=conversation_id;
