import { randomUUID } from "node:crypto";
import { Store } from "../database/store.ts";
import {
  isWhatsAppConversationContent,
  type WhatsAppConnectorMessage,
} from "./connector.ts";
import {
  normalizeWhatsAppSender,
  whatsappParticipantDisplayName,
} from "./participants.ts";
import {
  availableTeamDisplayName,
  resolveWhatsAppTeamIdentity,
} from "./team-directory.ts";

export class WhatsAppRawInbox {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  ingest(
    message: WhatsAppConnectorMessage,
    receivedAt = new Date().toISOString(),
    syncRunId: string | null = null,
  ) {
    return this.store.transaction(() => {
      const senderId = normalizeWhatsAppSender(message);
      const teamIdentity = resolveWhatsAppTeamIdentity(
        this.store,
        message.accountId,
        senderId,
        message.senderName,
      );
      this.store.db
        .prepare(
          "INSERT INTO whatsapp_raw_chats(account_id,conversation_id,title,is_group,first_captured_at,last_captured_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,conversation_id) DO UPDATE SET title=CASE WHEN excluded.title=excluded.conversation_id AND whatsapp_raw_chats.title<>whatsapp_raw_chats.conversation_id THEN whatsapp_raw_chats.title ELSE excluded.title END,is_group=excluded.is_group,last_captured_at=MAX(whatsapp_raw_chats.last_captured_at,excluded.last_captured_at)",
        )
        .run(
          message.accountId,
          message.conversationId,
          message.conversationTitle,
          message.isGroup ? 1 : 0,
          message.sentAt,
          message.sentAt,
        );
      const rawId = randomUUID();
      const result = this.store.db
        .prepare(
          "INSERT OR IGNORE INTO whatsapp_raw_messages(id,account_id,conversation_id,external_id,sender_id,direction,text,sent_at,received_at,message_type,has_media,sender_name,sync_run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          rawId,
          message.accountId,
          message.conversationId,
          message.externalId,
          senderId,
          message.direction,
          message.text,
          message.sentAt,
          receivedAt,
          message.messageType,
          message.hasMedia ? 1 : 0,
          message.senderName ?? null,
          syncRunId,
        );
      let attachedToSync = false;
      if (result.changes === 0 && syncRunId) {
        const attached = this.store.db
          .prepare(
            "UPDATE whatsapp_raw_messages SET sync_run_id=? WHERE account_id=? AND conversation_id=? AND external_id=? AND (sync_run_id IS NULL OR sync_run_id IN (SELECT id FROM whatsapp_sync_runs WHERE status='failed'))",
          )
          .run(
            syncRunId,
            message.accountId,
            message.conversationId,
            message.externalId,
          );
        attachedToSync = attached.changes === 1;
      }
      if (
        result.changes === 1 &&
        message.text.trim().length > 0 &&
        isWhatsAppConversationContent(message.messageType)
      ) {
        const mapping = this.store.db
          .prepare(
            "SELECT project_id,live_conversation_id,mapping_state FROM whatsapp_raw_chats WHERE account_id=? AND conversation_id=?",
          )
          .get(message.accountId, message.conversationId);
        if (
          mapping?.project_id &&
          mapping.live_conversation_id &&
          mapping.mapping_state === "mapped"
        ) {
          let participant = this.store.db
            .prepare(
              "SELECT id FROM participants WHERE project_id=? AND external_sender_id=?",
            )
            .get(mapping.project_id, senderId);
          if (!participant) {
            const participantId = randomUUID();
            const displayName = availableTeamDisplayName(
              this.store,
              String(mapping.project_id),
              teamIdentity
                ? teamIdentity.displayName
                : whatsappParticipantDisplayName(senderId, message.direction),
              senderId,
            );
            this.store.db
              .prepare(
                "INSERT INTO participants(id,project_id,display_name,role,created_at,external_sender_id) VALUES(?,?,?,?,?,?)",
              )
              .run(
                participantId,
                mapping.project_id,
                displayName,
                teamIdentity || message.direction === "outgoing"
                  ? "team"
                  : senderId.startsWith('unknown-group-participant:') ? "unknown" : "client",
                receivedAt,
                senderId,
              );
            participant = { id: participantId };
          } else if (teamIdentity) {
            const displayName = availableTeamDisplayName(
              this.store,
              String(mapping.project_id),
              teamIdentity.displayName,
              senderId,
            );
            this.store.db
              .prepare(
                "UPDATE participants SET display_name=?,role='team' WHERE id=?",
              )
              .run(displayName, participant.id);
          }
          const mirrored = this.store.db
            .prepare(
              "INSERT OR IGNORE INTO messages(id,account_id,external_id,project_id,conversation_id,sender_id,direction,text,sent_at,received_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,'live')",
            )
            .run(
              randomUUID(),
              message.accountId,
              message.externalId,
              mapping.project_id,
              mapping.live_conversation_id,
              participant.id,
              message.direction,
              message.text,
              message.sentAt,
              receivedAt,
            );
          if (mirrored.changes === 1) {
            this.store.db
              .prepare(
                "UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?",
              )
              .run(receivedAt, mapping.project_id);
            this.store.db
              .prepare(
                "UPDATE conversations SET captured_from=MIN(captured_from,?),captured_through=MAX(captured_through,?) WHERE id=?",
              )
              .run(
                message.sentAt,
                message.sentAt,
                mapping.live_conversation_id,
              );
          }
        }
      }
      return { duplicate: result.changes === 0, attachedToSync };
    });
  }
}
