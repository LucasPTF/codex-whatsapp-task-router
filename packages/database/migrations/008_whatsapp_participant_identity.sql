ALTER TABLE participants ADD COLUMN external_sender_id TEXT;

UPDATE participants AS participant
SET external_sender_id = 'unknown-group-participant:' || (
  SELECT chat.conversation_id
  FROM whatsapp_raw_chats AS chat
  WHERE chat.project_id = participant.project_id
    AND chat.is_group = 1
    AND chat.conversation_id = participant.display_name
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM whatsapp_raw_chats AS chat
  WHERE chat.project_id = participant.project_id
    AND chat.is_group = 1
    AND chat.conversation_id = participant.display_name
);

UPDATE whatsapp_raw_messages
SET sender_id = 'unknown-group-participant:' || conversation_id
WHERE sender_id = conversation_id
  AND EXISTS (
    SELECT 1
    FROM whatsapp_raw_chats AS chat
    WHERE chat.account_id = whatsapp_raw_messages.account_id
      AND chat.conversation_id = whatsapp_raw_messages.conversation_id
      AND chat.is_group = 1
  );

UPDATE participants AS participant
SET external_sender_id = participant.display_name
WHERE participant.external_sender_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM whatsapp_raw_chats AS chat
    JOIN whatsapp_raw_messages AS message
      ON message.account_id = chat.account_id
     AND message.conversation_id = chat.conversation_id
    WHERE chat.project_id = participant.project_id
      AND message.sender_id = participant.display_name
  );

UPDATE participants
SET display_name = 'Cliente não identificado'
WHERE external_sender_id LIKE 'unknown-group-participant:%';

UPDATE participants AS participant
SET display_name = 'Equipe (WhatsApp conectado)'
WHERE participant.external_sender_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM whatsapp_raw_chats AS chat
    JOIN whatsapp_raw_messages AS message
      ON message.account_id = chat.account_id
     AND message.conversation_id = chat.conversation_id
    WHERE chat.project_id = participant.project_id
      AND message.sender_id = participant.external_sender_id
      AND message.direction = 'outgoing'
  );

CREATE UNIQUE INDEX participant_external_sender
  ON participants(project_id,external_sender_id)
  WHERE external_sender_id IS NOT NULL;
