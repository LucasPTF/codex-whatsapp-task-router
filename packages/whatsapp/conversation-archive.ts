import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../database/store.ts";
import { isWhatsAppConversationContent } from "./connector.ts";

type ProjectArchiveRow = {
  id: string;
  name: string;
  account_id: string;
  conversation_id: string;
  title: string;
};

function safeFolderName(value: string) {
  const normalized = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  const safe = normalized || "Cliente sem nome";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)
    ? `_${safe}`
    : safe;
}

function textLine(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\n    ");
}

export class WhatsAppConversationArchive {
  private readonly store: Store;
  private readonly root: string;

  constructor(store: Store, root: string) {
    this.store = store;
    this.root = root;
  }

  private project(projectId: string) {
    return this.store.db
      .prepare(
        "SELECT p.id,p.name,c.account_id,c.conversation_id,c.title FROM projects p JOIN whatsapp_raw_chats c ON c.project_id=p.id WHERE p.id=? AND c.mapping_state='mapped' LIMIT 1",
      )
      .get(projectId) as unknown as ProjectArchiveRow | undefined;
  }

  refreshProject(projectId: string) {
    const project = this.project(projectId);
    if (!project) return false;
    const folder = join(
      this.root,
      `${safeFolderName(project.name)}__${project.id.slice(0, 8)}`,
    );
    mkdirSync(folder, { recursive: true });
    const messages = this.store.db
      .prepare(
        "SELECT r.conversation_id,c.title conversation_title,r.external_id,r.sender_id,COALESCE(person.display_name,r.sender_name,r.sender_id) sender_name,COALESCE(person.role,'unknown') sender_role,r.direction,r.text,r.sent_at,r.received_at,r.message_type,r.has_media FROM whatsapp_raw_messages r JOIN whatsapp_raw_chats c ON c.account_id=r.account_id AND c.conversation_id=r.conversation_id LEFT JOIN messages m ON m.account_id=r.account_id AND m.conversation_id=c.live_conversation_id AND m.external_id=r.external_id AND m.project_id=c.project_id LEFT JOIN participants person ON person.id=m.sender_id WHERE c.project_id=? AND c.mapping_state='mapped' ORDER BY r.sent_at,r.conversation_id,r.external_id",
      )
      .all(project.id)
      .filter((message) =>
        isWhatsAppConversationContent(String(message.message_type)),
      );
    const exportedAt = new Date().toISOString();
    writeFileSync(
      join(folder, "informacoes.json"),
      `${JSON.stringify(
        {
          projectId: project.id,
          clientName: project.name,
          whatsappGroup: project.title,
          conversationId: project.conversation_id,
          conversations: this.store.db.prepare("SELECT conversation_id,title FROM whatsapp_raw_chats WHERE project_id=? AND mapping_state='mapped' ORDER BY conversation_id").all(project.id),
          messageCount: messages.length,
          exportedAt,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeFileSync(
      join(folder, "mensagens.jsonl"),
      messages
        .map((row) =>
          JSON.stringify({
            externalId: String(row.external_id),
            conversationId: String(row.conversation_id),
            senderRole: String(row.sender_role),
            sentAt: String(row.sent_at),
            receivedAt: String(row.received_at),
            direction: String(row.direction),
            senderId: String(row.sender_id),
            senderName: String(row.sender_name),
            text: String(row.text),
            messageType: String(row.message_type),
            hasMedia: Boolean(row.has_media),
          }),
        )
        .join("\n") + (messages.length ? "\n" : ""),
      "utf8",
    );
    writeFileSync(
      join(folder, "conversa.txt"),
      messages
        .map(
          (row) =>
            `[${row.sent_at}] ${row.sender_role === "client" ? "CLIENTE" : row.sender_role === "team" ? "EQUIPE" : "AUTORIA NÃO IDENTIFICADA"} · ${textLine(row.sender_name)} · ${textLine(row.conversation_title)}\n    ${textLine(row.text)}`,
        )
        .join("\n\n") + (messages.length ? "\n" : ""),
      "utf8",
    );
    return true;
  }

  refreshAll() {
    mkdirSync(this.root, { recursive: true });
    const projects = this.store.db
      .prepare(
        "SELECT DISTINCT project_id FROM whatsapp_raw_chats WHERE mapping_state='mapped' AND project_id IS NOT NULL",
      )
      .all();
    let refreshed = 0;
    for (const row of projects)
      if (this.refreshProject(String(row.project_id))) refreshed += 1;
    return refreshed;
  }

  refreshForSync(syncRunId: string) {
    const projects = this.store.db
      .prepare(
        "SELECT DISTINCT c.project_id FROM whatsapp_raw_messages m JOIN whatsapp_raw_chats c ON c.account_id=m.account_id AND c.conversation_id=m.conversation_id WHERE m.sync_run_id=? AND c.mapping_state='mapped' AND c.project_id IS NOT NULL",
      )
      .all(syncRunId);
    let refreshed = 0;
    for (const row of projects)
      if (this.refreshProject(String(row.project_id))) refreshed += 1;
    return refreshed;
  }
}
