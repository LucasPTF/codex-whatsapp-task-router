import { randomUUID } from "node:crypto";
import type { Actor } from "../core/model.ts";
import { demand } from "../core/model.ts";
import type { Store } from "../database/store.ts";
import { isWhatsAppConversationContent } from "./connector.ts";
import { whatsappParticipantDisplayName } from "./participants.ts";
import {
  availableTeamDisplayName,
  resolveWhatsAppTeamIdentity,
} from "./team-directory.ts";

type RawGroup = {
  conversation_id: string;
  title: string;
  first_captured_at: string;
  last_captured_at: string;
  project_id: string | null;
  live_conversation_id: string | null;
  mapping_state: "pending" | "mapped" | "ignored";
  mapping_method: "manual" | "automatic" | null;
  message_count: number;
};

export type ClientGroupClassification = {
  eligible: boolean;
  reasons: string[];
};

const NUMERIC_PREFIX = /^\s*\d{1,4}\s*\)/u;
const TM_PREFIX = /^\s*\[\s*TM\s*\]/iu;
const L2_MARKER = /(?:^|[\s.\[-])L\.?\s*2(?:\b|[-\]])/iu;
const T_NUMBER_MARKER = /\bT\s*\d{2,4}\b/iu;
const MONTH_MARKER =
  /(?:[\[(]\s*T?\s*(?:JAN(?:EIRO)?|FEV(?:EREIRO)?|MAR(?:ÇO|CO)?|ABR(?:IL)?|MAI(?:O)?|JUN(?:HO)?|JUL(?:HO)?|AGO(?:STO)?|SET(?:EMBRO)?|OUT(?:UBRO)?|NOV(?:EMBRO)?|DEZ(?:EMBRO)?)\s*[\])]|\bT\s*(?:JAN(?:EIRO)?|FEV(?:EREIRO)?|MAR(?:ÇO|CO)?|ABR(?:IL)?|MAI(?:O)?|JUN(?:HO)?|JUL(?:HO)?|AGO(?:STO)?|SET(?:EMBRO)?|OUT(?:UBRO)?|NOV(?:EMBRO)?|DEZ(?:EMBRO)?)\b)/iu;
const MONTH_WORD =
  /\b(?:JANEIRO|FEVEREIRO|MARÇO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\b/iu;
const PERCENT_MARKER = /\[\s*\d{1,3}\s*%\s*\]/u;
const EXEC_MARKER = /\[\s*EXEC(?:\.\d+)?\s*\]/iu;

export function classifyClientGroupTitle(
  title: string,
): ClientGroupClassification {
  const reasons: string[] = [];
  const hasNumericPrefix = NUMERIC_PREFIX.test(title);
  const hasTmPrefix = TM_PREFIX.test(title);
  const hasL2 = L2_MARKER.test(title);
  const hasPurchaseMonth =
    MONTH_MARKER.test(title) || (hasL2 && MONTH_WORD.test(title));
  const hasOperationalMarker =
    hasPurchaseMonth || PERCENT_MARKER.test(title) || EXEC_MARKER.test(title);
  if (hasNumericPrefix) reasons.push("numeric_prefix");
  if (hasPurchaseMonth) reasons.push("purchase_month");
  if (hasL2 || T_NUMBER_MARKER.test(title)) reasons.push("customer_code");
  if (hasTmPrefix && hasOperationalMarker) reasons.push("tm_operation");
  if (hasL2 && hasOperationalMarker) reasons.push("l2_operation");
  return { eligible: reasons.length > 0, reasons };
}

export class WhatsAppOnboarding {
  private readonly store: Store;
  private readonly accountId: string;
  private readonly allowDemoManager: boolean;

  constructor(store: Store, accountId: string, allowDemoManager: boolean) {
    this.store = store;
    this.accountId = accountId;
    this.allowDemoManager = allowDemoManager;
  }

  private authorize(actor: Actor) {
    demand(
      actor.role === "admin" || actor.role === "manager",
      "FORBIDDEN",
      403,
    );
  }

  private authorizeGroup(actor: Actor, conversationId: string) {
    this.authorize(actor);
    const group = this.store.db.prepare('SELECT project_id FROM whatsapp_raw_chats WHERE account_id=? AND conversation_id=?').get(this.accountId, conversationId);
    if (group?.project_id && actor.role !== 'admin')
      demand(this.store.db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND employee_id=?').get(group.project_id, actor.id), 'FORBIDDEN', 403);
  }

  listGroups(actor: Actor) {
    this.authorize(actor);
    return (
      this.store.db
        .prepare(
          "SELECT c.conversation_id,c.title,c.first_captured_at,c.last_captured_at,c.project_id,c.live_conversation_id,c.mapping_state,c.mapping_method,COUNT(m.id) message_count FROM whatsapp_raw_chats c LEFT JOIN whatsapp_raw_messages m ON m.account_id=c.account_id AND m.conversation_id=c.conversation_id WHERE c.account_id=? AND c.is_group=1 GROUP BY c.account_id,c.conversation_id ORDER BY c.title COLLATE NOCASE,c.conversation_id",
        )
        .all(this.accountId) as unknown as RawGroup[]
    ).filter((group) => actor.role === 'admin' || !group.project_id || Boolean(this.store.db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND employee_id=?').get(group.project_id, actor.id))).map((group) => {
      const classification = classifyClientGroupTitle(group.title);
      return {
        conversationId: group.conversation_id,
        title: group.title,
        firstCapturedAt: group.first_captured_at,
        lastCapturedAt: group.last_captured_at,
        projectId: group.project_id,
        messageCount: Number(group.message_count),
        mappingState: group.mapping_state,
        mappingMethod: group.mapping_method,
        autoEligible: classification.eligible,
        classificationReasons: classification.reasons,
      };
    });
  }

  mapGroup(
    actor: Actor,
    conversationId: string,
    requestedMemberIds: string[],
    now = new Date().toISOString(),
    mappingMethod: "manual" | "automatic" = "manual",
  ) {
    this.authorizeGroup(actor, conversationId);
    demand(
      conversationId.length >= 3 && conversationId.length <= 200,
      "INVALID_CONVERSATION_ID",
      400,
    );
    demand(requestedMemberIds.length <= 100, "TOO_MANY_MEMBERS", 400);
    const group = this.store.db
      .prepare(
        "SELECT c.*,(SELECT COUNT(*) FROM whatsapp_raw_messages m WHERE m.account_id=c.account_id AND m.conversation_id=c.conversation_id) message_count FROM whatsapp_raw_chats c WHERE c.account_id=? AND c.conversation_id=? AND c.is_group=1",
      )
      .get(this.accountId, conversationId) as unknown as RawGroup | undefined;
    demand(group, "WHATSAPP_GROUP_NOT_FOUND", 404);
    if (group.project_id)
      return {
        duplicate: true,
        clientId: String(
          this.store.db
            .prepare("SELECT client_id FROM projects WHERE id=?")
            .get(group.project_id)!.client_id,
        ),
        projectId: group.project_id,
        title: group.title,
        messageCount: group.message_count,
      };
    demand(
      group.title.trim().length >= 2 && group.title.length <= 120,
      "INVALID_GROUP_TITLE",
      400,
    );
    const memberIds = new Set(requestedMemberIds);
    const operationalMembers = this.store.db
      .prepare(
        "SELECT DISTINCT e.id FROM employees e JOIN capabilities c ON c.employee_id=e.id WHERE e.active=1 AND c.kind IN ('copy','design','page','strategy','service','traffic')",
      )
      .all();
    for (const member of operationalMembers) memberIds.add(String(member.id));
    if (actor.role === "manager") memberIds.add(actor.id);
    for (const employeeId of memberIds)
      demand(
        this.store.db
          .prepare("SELECT 1 FROM employees WHERE id=? AND active=1")
          .get(employeeId),
        "EMPLOYEE_NOT_FOUND",
        404,
      );

    const clientId = randomUUID();
    const projectId = randomUUID();
    const liveConversationId = randomUUID();
    let createdClient = true;
    let createdProject = true;
    let selectedProjectId: string = projectId;
    let importedMessages = 0;
    this.store.transaction(() => {
      const existingClient = this.store.db
        .prepare(
          "SELECT id FROM clients WHERE name=? COLLATE NOCASE AND active=1",
        )
        .get(group.title);
      const selectedClientId = existingClient
        ? String(existingClient.id)
        : clientId;
      createdClient = !existingClient;
      if (!existingClient)
        this.store.db
          .prepare(
            "INSERT INTO clients(id,name,created_at,updated_at) VALUES(?,?,?,?)",
          )
          .run(clientId, group.title, now, now);
      const existingProject = this.store.db
        .prepare(
          "SELECT id FROM projects WHERE client_id=? AND name=? COLLATE NOCASE AND active=1 ORDER BY created_at,id LIMIT 1",
        )
        .get(selectedClientId, group.title);
      selectedProjectId = existingProject
        ? String(existingProject.id)
        : projectId;
      createdProject = !existingProject;
      if (!existingProject)
        this.store.db
          .prepare(
            "INSERT INTO projects(id,name,client_id,description,created_at,updated_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            projectId,
            group.title,
            selectedClientId,
            `Criado a partir do grupo do WhatsApp: ${group.title}`,
            now,
            now,
          );
      for (const employeeId of memberIds)
        this.store.db
          .prepare(
            "INSERT OR IGNORE INTO project_members(project_id,employee_id) VALUES(?,?)",
          )
          .run(selectedProjectId, employeeId);
      if (!existingProject)
        this.store.db
          .prepare(
            "INSERT INTO project_briefs(project_id,version,objective,offer,audience,channel,restrictions,created_at,created_by) VALUES(?,1,'','','','WhatsApp','',?,?)",
          )
          .run(selectedProjectId, now, actor.id);
      this.store.db
        .prepare(
          "INSERT INTO conversations(id,project_id,title,source,captured_from,captured_through,imported_at,created_at) VALUES(?,?,?,'live',?,?,?,?)",
        )
        .run(
          liveConversationId,
          selectedProjectId,
          group.title,
          group.first_captured_at,
          group.last_captured_at,
          now,
          now,
        );
      const participantIds = new Map<string, string>();
      const existingParticipants = this.store.db
        .prepare(
          "SELECT id,external_sender_id FROM participants WHERE project_id=? AND external_sender_id IS NOT NULL",
        )
        .all(selectedProjectId);
      for (const participant of existingParticipants)
        participantIds.set(
          String(participant.external_sender_id),
          String(participant.id),
        );
      const senders = this.store.db
        .prepare(
          "SELECT sender_id,MAX(sender_name) sender_name,MAX(CASE WHEN direction='outgoing' THEN 1 ELSE 0 END) is_team FROM whatsapp_raw_messages WHERE account_id=? AND conversation_id=? GROUP BY sender_id",
        )
        .all(this.accountId, conversationId);
      for (const sender of senders) {
        const senderId = String(sender.sender_id);
        if (participantIds.has(senderId)) continue;
        const participantId = randomUUID();
        const identity = resolveWhatsAppTeamIdentity(
          this.store,
          this.accountId,
          senderId,
          sender.sender_name ? String(sender.sender_name) : null,
        );
        const isTeam = Boolean(identity) || Boolean(Number(sender.is_team));
        const direction = isTeam ? "outgoing" : "incoming";
        const displayName = availableTeamDisplayName(
          this.store,
          selectedProjectId,
          identity
            ? identity.displayName
            : whatsappParticipantDisplayName(senderId, direction),
          senderId,
        );
        participantIds.set(senderId, participantId);
        this.store.db
          .prepare(
            "INSERT INTO participants(id,project_id,display_name,role,created_at,external_sender_id) VALUES(?,?,?,?,?,?)",
          )
          .run(
            participantId,
            selectedProjectId,
            displayName,
            isTeam ? "team" : senderId.startsWith('unknown-group-participant:') ? "unknown" : "client",
            now,
            senderId,
          );
      }
      const insert = this.store.db.prepare(
        "INSERT OR IGNORE INTO messages(id,account_id,external_id,project_id,conversation_id,sender_id,direction,text,sent_at,received_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,'live')",
      );
      const rawMessages = this.store.db
        .prepare(
          "SELECT * FROM whatsapp_raw_messages WHERE account_id=? AND conversation_id=? ORDER BY sent_at,id",
        )
        .all(this.accountId, conversationId)
        .filter((message) =>
          isWhatsAppConversationContent(String(message.message_type)),
        );
      for (const message of rawMessages)
        importedMessages += Number(
          insert.run(
            randomUUID(),
            this.accountId,
            message.external_id,
            selectedProjectId,
            liveConversationId,
            participantIds.get(String(message.sender_id))!,
            message.direction,
            message.text,
            message.sent_at,
            message.received_at,
          ).changes,
        );
      this.store.db
        .prepare(
          "UPDATE projects SET revision=revision+?,updated_at=? WHERE id=?",
        )
        .run(importedMessages, now, selectedProjectId);
      this.store.db
        .prepare(
          "UPDATE whatsapp_raw_chats SET project_id=?,live_conversation_id=?,mapping_state='mapped',mapping_method=? WHERE account_id=? AND conversation_id=? AND project_id IS NULL",
        )
        .run(
          selectedProjectId,
          liveConversationId,
          mappingMethod,
          this.accountId,
          conversationId,
        );
      this.store.db
        .prepare(
          "INSERT INTO audit_logs(actor_id,action,entity_id,payload,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          actor.id,
          "whatsapp.group_mapped",
          selectedProjectId,
          JSON.stringify({
            accountId: this.accountId,
            conversationId,
            exactTitle: group.title,
            clientId: selectedClientId,
            createdClient,
            createdProject,
            importedMessages,
            mappingMethod,
          }),
          now,
        );
      this.store.db
        .prepare("INSERT INTO events(kind,payload,created_at) VALUES(?,?,?)")
        .run(
          "whatsapp.group_mapped",
          JSON.stringify({
            projectId: selectedProjectId,
            conversationId,
            importedMessages,
          }),
          now,
        );
    });
    const selectedClientId = String(
      this.store.db
        .prepare("SELECT client_id FROM projects WHERE id=?")
        .get(selectedProjectId)!.client_id,
    );
    return {
      duplicate: false,
      clientId: selectedClientId,
      projectId: selectedProjectId,
      title: group.title,
      messageCount: importedMessages,
      createdClient,
      createdProject,
      mappingMethod,
    };
  }

  autoMapEligibleGroups(now = new Date().toISOString()) {
    const actorRow = this.store.db
      .prepare(
        this.allowDemoManager
          ? "SELECT id,role FROM employees WHERE active=1 AND role IN ('admin','manager') ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END,id LIMIT 1"
          : "SELECT id,role FROM employees WHERE active=1 AND role='admin' ORDER BY id LIMIT 1",
      )
      .get();
    if (!actorRow) return { mapped: 0, skipped: 0, failed: 0, results: [] };
    const actor = {
      id: String(actorRow.id),
      role: String(actorRow.role) as Actor["role"],
    };
    const candidates = this.store.db
      .prepare(
        "SELECT conversation_id,title FROM whatsapp_raw_chats WHERE account_id=? AND is_group=1 AND mapping_state='pending' ORDER BY title COLLATE NOCASE,conversation_id",
      )
      .all(this.accountId);
    const results: Array<{
      conversationId: string;
      title: string;
      projectId: string | null;
      error: string | null;
    }> = [];
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const conversationId = String(candidate.conversation_id);
      const title = String(candidate.title);
      if (!classifyClientGroupTitle(title).eligible) {
        skipped += 1;
        continue;
      }
      try {
        const mapped = this.mapGroup(
          actor,
          conversationId,
          [],
          now,
          "automatic",
        );
        results.push({
          conversationId,
          title,
          projectId: mapped.projectId,
          error: null,
        });
      } catch (error) {
        failed += 1;
        results.push({
          conversationId,
          title,
          projectId: null,
          error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        });
      }
    }
    return { mapped: results.length - failed, skipped, failed, results };
  }

  ignoreGroup(
    actor: Actor,
    conversationId: string,
    now = new Date().toISOString(),
  ) {
    this.authorizeGroup(actor, conversationId);
    demand(
      conversationId.length >= 3 && conversationId.length <= 200,
      "INVALID_CONVERSATION_ID",
      400,
    );
    const group = this.store.db
      .prepare(
        "SELECT conversation_id,title,project_id,mapping_state FROM whatsapp_raw_chats WHERE account_id=? AND conversation_id=? AND is_group=1",
      )
      .get(this.accountId, conversationId);
    demand(group, "WHATSAPP_GROUP_NOT_FOUND", 404);
    if (group.mapping_state === "ignored") return { duplicate: true };
    this.store.transaction(() => {
      if (group.project_id) {
        this.store.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?').run(now, group.project_id);
        const hasAnotherMappedGroup = this.store.db
          .prepare(
            "SELECT 1 FROM whatsapp_raw_chats WHERE account_id=? AND project_id=? AND conversation_id<>? AND mapping_state='mapped' LIMIT 1",
          )
          .get(this.accountId, group.project_id, conversationId);
        if (!hasAnotherMappedGroup) {
          this.store.db
            .prepare(
              "UPDATE projects SET active=0,revision=revision+1,updated_at=? WHERE id=?",
            )
            .run(now, group.project_id);
          const client = this.store.db
            .prepare("SELECT client_id FROM projects WHERE id=?")
            .get(group.project_id);
          if (
            client?.client_id &&
            !this.store.db
              .prepare(
                "SELECT 1 FROM projects WHERE client_id=? AND active=1 AND id<>? LIMIT 1",
              )
              .get(client.client_id, group.project_id)
          )
            this.store.db
              .prepare("UPDATE clients SET active=0,updated_at=? WHERE id=?")
              .run(now, client.client_id);
        }
      }
      this.store.db
        .prepare(
          "UPDATE whatsapp_raw_chats SET mapping_state='ignored' WHERE account_id=? AND conversation_id=?",
        )
        .run(this.accountId, conversationId);
      this.store.db
        .prepare(
          "INSERT INTO audit_logs(actor_id,action,entity_id,payload,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          actor.id,
          "whatsapp.group_ignored",
          group.project_id ?? conversationId,
          JSON.stringify({
            accountId: this.accountId,
            conversationId,
            exactTitle: group.title,
            projectId: group.project_id,
          }),
          now,
        );
    });
    return { duplicate: false, projectId: group.project_id };
  }

  restoreGroup(
    actor: Actor,
    conversationId: string,
    now = new Date().toISOString(),
  ) {
    this.authorizeGroup(actor, conversationId);
    demand(
      conversationId.length >= 3 && conversationId.length <= 200,
      "INVALID_CONVERSATION_ID",
      400,
    );
    const group = this.store.db
      .prepare(
        "SELECT conversation_id,title,project_id,live_conversation_id,mapping_state FROM whatsapp_raw_chats WHERE account_id=? AND conversation_id=? AND is_group=1",
      )
      .get(this.accountId, conversationId);
    demand(group, "WHATSAPP_GROUP_NOT_FOUND", 404);
    demand(
      group.mapping_state === "ignored",
      "WHATSAPP_GROUP_NOT_IGNORED",
      409,
    );
    let importedMessages = 0;
    const restoredState = group.project_id ? "mapped" : "pending";
    this.store.transaction(() => {
      if (group.project_id && group.live_conversation_id) {
        const project = this.store.db
          .prepare("SELECT client_id FROM projects WHERE id=?")
          .get(group.project_id);
        demand(project, "PROJECT_NOT_FOUND", 404);
        this.store.db
          .prepare(
            "UPDATE projects SET active=1,revision=revision+1,updated_at=? WHERE id=?",
          )
          .run(now, group.project_id);
        if (project.client_id)
          this.store.db
            .prepare("UPDATE clients SET active=1,updated_at=? WHERE id=?")
            .run(now, project.client_id);

        const participantIds = new Map<string, string>();
        const existingParticipants = this.store.db
          .prepare(
            "SELECT id,external_sender_id FROM participants WHERE project_id=? AND external_sender_id IS NOT NULL",
          )
          .all(group.project_id);
        for (const participant of existingParticipants)
          participantIds.set(
            String(participant.external_sender_id),
            String(participant.id),
          );
        const senders = this.store.db
          .prepare(
            "SELECT sender_id,MAX(sender_name) sender_name,MAX(CASE WHEN direction='outgoing' THEN 1 ELSE 0 END) is_team FROM whatsapp_raw_messages WHERE account_id=? AND conversation_id=? GROUP BY sender_id",
          )
          .all(this.accountId, conversationId);
        for (const sender of senders) {
          const senderId = String(sender.sender_id);
          if (participantIds.has(senderId)) continue;
          const participantId = randomUUID();
          participantIds.set(senderId, participantId);
          const identity = resolveWhatsAppTeamIdentity(
            this.store,
            this.accountId,
            senderId,
            sender.sender_name ? String(sender.sender_name) : null,
          );
          const isTeam = Boolean(identity) || Boolean(Number(sender.is_team));
          const direction = isTeam ? "outgoing" : "incoming";
          const displayName = availableTeamDisplayName(
            this.store,
            String(group.project_id),
            identity
              ? identity.displayName
              : whatsappParticipantDisplayName(senderId, direction),
            senderId,
          );
          this.store.db
            .prepare(
              "INSERT INTO participants(id,project_id,display_name,role,created_at,external_sender_id) VALUES(?,?,?,?,?,?)",
            )
            .run(
              participantId,
              group.project_id,
              displayName,
              isTeam ? "team" : senderId.startsWith('unknown-group-participant:') ? "unknown" : "client",
              now,
              senderId,
            );
        }
        const insert = this.store.db.prepare(
          "INSERT OR IGNORE INTO messages(id,account_id,external_id,project_id,conversation_id,sender_id,direction,text,sent_at,received_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,'live')",
        );
        const rawMessages = this.store.db
          .prepare(
            "SELECT * FROM whatsapp_raw_messages WHERE account_id=? AND conversation_id=? ORDER BY sent_at,id",
          )
          .all(this.accountId, conversationId)
          .filter((message) =>
            isWhatsAppConversationContent(String(message.message_type)),
          );
        for (const message of rawMessages)
          importedMessages += Number(
            insert.run(
              randomUUID(),
              this.accountId,
              message.external_id,
              group.project_id,
              group.live_conversation_id,
              participantIds.get(String(message.sender_id))!,
              message.direction,
              message.text,
              message.sent_at,
              message.received_at,
            ).changes,
          );
        if (importedMessages) {
          this.store.db
            .prepare(
              "UPDATE projects SET revision=revision+?,updated_at=? WHERE id=?",
            )
            .run(importedMessages, now, group.project_id);
          this.store.db
            .prepare(
              "UPDATE conversations SET captured_from=(SELECT MIN(sent_at) FROM whatsapp_raw_messages WHERE account_id=? AND conversation_id=?),captured_through=(SELECT MAX(sent_at) FROM whatsapp_raw_messages WHERE account_id=? AND conversation_id=?) WHERE id=?",
            )
            .run(
              this.accountId,
              conversationId,
              this.accountId,
              conversationId,
              group.live_conversation_id,
            );
        }
      }
      this.store.db
        .prepare(
          "UPDATE whatsapp_raw_chats SET mapping_state=? WHERE account_id=? AND conversation_id=?",
        )
        .run(restoredState, this.accountId, conversationId);
      this.store.db
        .prepare(
          "INSERT INTO audit_logs(actor_id,action,entity_id,payload,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          actor.id,
          "whatsapp.group_restored",
          group.project_id ?? conversationId,
          JSON.stringify({
            accountId: this.accountId,
            conversationId,
            exactTitle: group.title,
            projectId: group.project_id,
            restoredState,
            importedMessages,
          }),
          now,
        );
    });
    return {
      projectId: group.project_id,
      mappingState: restoredState,
      importedMessages,
    };
  }
}
