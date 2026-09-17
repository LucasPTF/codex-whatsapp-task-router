import { randomUUID } from "node:crypto";
import { Store } from "../database/store.ts";
import { parseWhatsAppExport } from "../whatsapp/import.ts";
import type { Actor, TaskKind } from "./model.ts";
import { DomainError, demand } from "./model.ts";

type ProjectInput = {
  clientId: string;
  name: string;
  description: string;
  memberIds: string[];
  brief: {
    objective: string;
    offer: string;
    audience: string;
    channel: string;
    restrictions: string;
  };
};

type ManualTaskInput = {
  projectId: string;
  title: string;
  description: string;
  kind: TaskKind;
  priority: "low" | "normal" | "high" | "urgent";
  dueAt: string | null;
  assigneeId: string | null;
  evidenceIds: string[];
};

function text(value: string, field: string, maximum: number, minimum = 0) {
  const normalized = value.trim();
  demand(
    normalized.length >= minimum && normalized.length <= maximum,
    "INVALID_" + field,
    400,
  );
  return normalized;
}

export class ProjectService {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  allowed(actor: Actor, projectId: string) {
    return (
      actor.role === "admin" ||
      !!this.store.db
        .prepare(
          "SELECT 1 FROM project_members WHERE project_id=? AND employee_id=?",
        )
        .get(projectId, actor.id)
    );
  }
  audit(
    actorId: string,
    action: string,
    entityId: string,
    payload: unknown,
    now: string,
  ) {
    this.store.db
      .prepare(
        "INSERT INTO audit_logs(actor_id,action,entity_id,payload,created_at) VALUES(?,?,?,?,?)",
      )
      .run(actorId, action, entityId, JSON.stringify(payload), now);
  }
  event(kind: string, payload: unknown, now: string) {
    this.store.db
      .prepare("INSERT INTO events(kind,payload,created_at) VALUES(?,?,?)")
      .run(kind, JSON.stringify(payload), now);
  }
  listClients(actor: Actor) {
    if (actor.role === "admin")
      return this.store.db
        .prepare(
          "SELECT c.*,COUNT(p.id) project_count FROM clients c LEFT JOIN projects p ON p.client_id=c.id GROUP BY c.id ORDER BY c.name",
        )
        .all();
    return this.store.db
      .prepare(
        "SELECT c.*,COUNT(DISTINCT p.id) project_count FROM clients c JOIN projects p ON p.client_id=c.id JOIN project_members m ON m.project_id=p.id WHERE m.employee_id=? GROUP BY c.id ORDER BY c.name",
      )
      .all(actor.id);
  }
  createClient(actor: Actor, name: string, now = new Date().toISOString()) {
    demand(actor.role === "admin", "FORBIDDEN", 403);
    const normalizedName = text(name, "CLIENT_NAME", 120, 2);
    demand(
      !this.store.db
        .prepare(
          "SELECT 1 FROM clients WHERE name=? COLLATE NOCASE AND active=1",
        )
        .get(normalizedName),
      "CLIENT_EXISTS",
    );
    const id = randomUUID();
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "INSERT INTO clients(id,name,created_at,updated_at) VALUES(?,?,?,?)",
        )
        .run(id, normalizedName, now, now);
      this.audit(actor.id, "client.created", id, { name: normalizedName }, now);
    });
    return id;
  }
  updateClient(
    actor: Actor,
    id: string,
    input: { name: string; active: boolean },
    now = new Date().toISOString(),
  ) {
    demand(actor.role === "admin", "FORBIDDEN", 403);
    const normalizedName = text(input.name, "CLIENT_NAME", 120, 2);
    demand(
      this.store.db.prepare("SELECT 1 FROM clients WHERE id=?").get(id),
      "NOT_FOUND",
      404,
    );
    this.store.transaction(() => {
      this.store.db
        .prepare("UPDATE clients SET name=?,active=?,updated_at=? WHERE id=?")
        .run(normalizedName, input.active ? 1 : 0, now, id);
      this.audit(
        actor.id,
        "client.updated",
        id,
        { name: normalizedName, active: input.active },
        now,
      );
    });
  }
  listProjects(actor: Actor) {
    const projects = (
      actor.role === "admin"
        ? this.store.db
            .prepare(
              "SELECT p.*,c.name client_name FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.active=1 ORDER BY p.name",
            )
            .all()
        : this.store.db
            .prepare(
              "SELECT p.*,c.name client_name FROM projects p LEFT JOIN clients c ON c.id=p.client_id JOIN project_members m ON m.project_id=p.id WHERE m.employee_id=? AND p.active=1 ORDER BY p.name",
            )
            .all(actor.id)
    ) as Record<string, unknown>[];
    return projects.map((project) => this.projectDetails(project));
  }
  private projectDetails(project: Record<string, unknown>) {
    const projectId = String(project.id);
    const brief = this.store.db
      .prepare(
        "SELECT * FROM project_briefs WHERE project_id=? ORDER BY version DESC LIMIT 1",
      )
      .get(projectId);
    const members = this.store.db
      .prepare(
        "SELECT e.id,e.name,e.role,e.active FROM project_members m JOIN employees e ON e.id=m.employee_id WHERE m.project_id=? ORDER BY e.name,e.id",
      )
      .all(projectId)
      .map((member) => ({
        ...member,
        capabilities: this.store.db
          .prepare(
            "SELECT kind FROM capabilities WHERE employee_id=? ORDER BY kind",
          )
          .all(member.id!)
          .map((capability) => String(capability.kind)),
      }));
    const participants = this.store.db
      .prepare(
        "SELECT id,display_name,role FROM participants WHERE project_id=? ORDER BY display_name",
      )
      .all(projectId);
    const conversations = this.store.db
      .prepare(
        "SELECT id,title,source,captured_from,captured_through,imported_at FROM conversations WHERE project_id=? ORDER BY created_at DESC",
      )
      .all(projectId);
    return {
      ...project,
      brief: brief ?? null,
      members,
      participants,
      conversations,
    };
  }
  getProject(actor: Actor, projectId: string) {
    demand(this.allowed(actor, projectId), "FORBIDDEN", 403);
    const project = this.store.db
      .prepare(
        "SELECT p.*,c.name client_name FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.id=?",
      )
      .get(projectId) as Record<string, unknown> | undefined;
    demand(project, "NOT_FOUND", 404);
    return this.projectDetails(project);
  }
  createProject(
    actor: Actor,
    input: ProjectInput,
    now = new Date().toISOString(),
  ) {
    demand(actor.role === "admin", "FORBIDDEN", 403);
    const name = text(input.name, "PROJECT_NAME", 140, 2);
    const description = text(input.description, "PROJECT_DESCRIPTION", 3000);
    demand(
      this.store.db
        .prepare("SELECT 1 FROM clients WHERE id=? AND active=1")
        .get(input.clientId),
      "CLIENT_NOT_FOUND",
      404,
    );
    demand(input.memberIds.length <= 100, "TOO_MANY_MEMBERS", 400);
    for (const employeeId of new Set(input.memberIds))
      demand(
        this.store.db
          .prepare("SELECT 1 FROM employees WHERE id=? AND active=1")
          .get(employeeId),
        "EMPLOYEE_NOT_FOUND",
        404,
      );
    const id = randomUUID();
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "INSERT INTO projects(id,name,client_id,description,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        )
        .run(id, name, input.clientId, description, now, now);
      for (const employeeId of new Set(input.memberIds))
        this.store.db
          .prepare(
            "INSERT INTO project_members(project_id,employee_id) VALUES(?,?)",
          )
          .run(id, employeeId);
      this.store.db
        .prepare(
          "INSERT INTO project_briefs(project_id,version,objective,offer,audience,channel,restrictions,created_at,created_by) VALUES(?,1,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          text(input.brief.objective, "BRIEF_OBJECTIVE", 3000),
          text(input.brief.offer, "BRIEF_OFFER", 3000),
          text(input.brief.audience, "BRIEF_AUDIENCE", 3000),
          text(input.brief.channel, "BRIEF_CHANNEL", 500),
          text(input.brief.restrictions, "BRIEF_RESTRICTIONS", 3000),
          now,
          actor.id,
        );
      this.audit(
        actor.id,
        "project.created",
        id,
        { clientId: input.clientId, memberIds: input.memberIds },
        now,
      );
    });
    return id;
  }
  updateProject(
    actor: Actor,
    projectId: string,
    input: {
      expectedRevision: number;
      name: string;
      description: string;
      active: boolean;
    },
    now = new Date().toISOString(),
  ) {
    demand(this.allowed(actor, projectId), "FORBIDDEN", 403);
    demand(actor.role !== "employee", "FORBIDDEN", 403);
    const project = this.store.db
      .prepare("SELECT revision FROM projects WHERE id=?")
      .get(projectId);
    demand(project, "NOT_FOUND", 404);
    demand(
      Number(project.revision) === input.expectedRevision,
      "VERSION_CONFLICT",
    );
    this.store.transaction(() => {
      const result = this.store.db
        .prepare(
          "UPDATE projects SET name=?,description=?,active=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
        )
        .run(
          text(input.name, "PROJECT_NAME", 140, 2),
          text(input.description, "PROJECT_DESCRIPTION", 3000),
          input.active ? 1 : 0,
          now,
          projectId,
          input.expectedRevision,
        );
      demand(result.changes === 1, "VERSION_CONFLICT");
      this.audit(actor.id, "project.updated", projectId, input, now);
    });
  }
  saveBrief(
    actor: Actor,
    projectId: string,
    input: ProjectInput["brief"] & { expectedRevision: number },
    now = new Date().toISOString(),
  ) {
    demand(this.allowed(actor, projectId), "FORBIDDEN", 403);
    demand(actor.role !== "employee", "FORBIDDEN", 403);
    return this.store.transaction(() => {
      const project = this.store.db
        .prepare("SELECT revision FROM projects WHERE id=?")
        .get(projectId);
      demand(project, "NOT_FOUND", 404);
      demand(
        Number(project.revision) === input.expectedRevision,
        "VERSION_CONFLICT",
      );
      const version =
        Number(
          this.store.db
            .prepare(
              "SELECT COALESCE(MAX(version),0) version FROM project_briefs WHERE project_id=?",
            )
            .get(projectId)!.version,
        ) + 1;
      this.store.db
        .prepare(
          "INSERT INTO project_briefs(project_id,version,objective,offer,audience,channel,restrictions,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          projectId,
          version,
          text(input.objective, "BRIEF_OBJECTIVE", 3000),
          text(input.offer, "BRIEF_OFFER", 3000),
          text(input.audience, "BRIEF_AUDIENCE", 3000),
          text(input.channel, "BRIEF_CHANNEL", 500),
          text(input.restrictions, "BRIEF_RESTRICTIONS", 3000),
          now,
          actor.id,
        );
      const changed = this.store.db
        .prepare(
          "UPDATE projects SET revision=revision+1,updated_at=? WHERE id=? AND revision=?",
        )
        .run(now, projectId, input.expectedRevision);
      demand(changed.changes === 1, "VERSION_CONFLICT");
      this.audit(
        actor.id,
        "project.brief_updated",
        projectId,
        { version },
        now,
      );
      return version;
    });
  }
  previewImport(
    actor: Actor,
    projectId: string,
    contents: string,
    utcOffset: string,
  ) {
    demand(this.allowed(actor, projectId), "FORBIDDEN", 403);
    try {
      const preview = parseWhatsAppExport(contents, utcOffset);
      return { ...preview, messages: preview.messages.slice(0, 20) };
    } catch (error) {
      throw new DomainError(
        error instanceof Error ? error.message : "INVALID_WHATSAPP_EXPORT",
        400,
      );
    }
  }
  importConversation(
    actor: Actor,
    projectId: string,
    input: {
      filename: string;
      title: string;
      contents: string;
      utcOffset: string;
      teamNames: string[];
    },
    now = new Date().toISOString(),
  ) {
    demand(this.allowed(actor, projectId), "FORBIDDEN", 403);
    demand(actor.role !== "employee", "FORBIDDEN", 403);
    const filename = text(input.filename, "IMPORT_FILENAME", 200, 1);
    demand(
      /\.txt$/i.test(filename) && !/[\\/]/.test(filename),
      "TXT_EXPORT_REQUIRED",
      400,
    );
    const title = text(input.title, "CONVERSATION_TITLE", 140, 2);
    let parsed;
    try {
      parsed = parseWhatsAppExport(input.contents, input.utcOffset);
    } catch (error) {
      throw new DomainError(
        error instanceof Error ? error.message : "INVALID_WHATSAPP_EXPORT",
        400,
      );
    }
    const old = this.store.db
      .prepare(
        "SELECT id,conversation_id,message_count FROM import_batches WHERE project_id=? AND content_hash=?",
      )
      .get(projectId, parsed.contentHash);
    if (old)
      return {
        duplicate: true,
        batchId: String(old.id),
        conversationId: String(old.conversation_id),
        messageCount: Number(old.message_count),
      };
    const team = new Set(
      input.teamNames.map((name) => name.trim().toLocaleLowerCase("pt-BR")),
    );
    const batchId = randomUUID();
    const conversationId = randomUUID();
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "INSERT INTO conversations(id,project_id,title,source,content_hash,captured_from,captured_through,imported_at,created_at) VALUES(?,?,?,'whatsapp_export',?,?,?,?,?)",
        )
        .run(
          conversationId,
          projectId,
          title,
          parsed.contentHash,
          parsed.capturedFrom,
          parsed.capturedThrough,
          now,
          now,
        );
      const participantIds = new Map<string, string>();
      for (const participant of parsed.participants) {
        const existing = this.store.db
          .prepare(
            "SELECT id,role FROM participants WHERE project_id=? AND display_name=?",
          )
          .get(projectId, participant.name);
        const role = team.has(participant.name.toLocaleLowerCase("pt-BR"))
          ? "team"
          : "client";
        if (existing) {
          participantIds.set(participant.name, String(existing.id));
          if (role === "team" && existing.role !== "team")
            this.store.db
              .prepare("UPDATE participants SET role='team' WHERE id=?")
              .run(existing.id!);
        } else {
          const participantId = randomUUID();
          participantIds.set(participant.name, participantId);
          this.store.db
            .prepare(
              "INSERT INTO participants(id,project_id,display_name,role,created_at) VALUES(?,?,?,?,?)",
            )
            .run(participantId, projectId, participant.name, role, now);
        }
      }
      const insertMessage = this.store.db.prepare(
        "INSERT INTO messages(id,account_id,external_id,project_id,conversation_id,sender_id,direction,text,sent_at,received_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,'import')",
      );
      for (const message of parsed.messages) {
        const participantId = participantIds.get(message.sender)!;
        const direction = team.has(message.sender.toLocaleLowerCase("pt-BR"))
          ? "outgoing"
          : "incoming";
        insertMessage.run(
          randomUUID(),
          "manual-whatsapp-export",
          `import:${parsed.contentHash}:${message.line}`,
          projectId,
          conversationId,
          participantId,
          direction,
          message.text,
          message.sentAt,
          now,
        );
      }
      this.store.db
        .prepare(
          "INSERT INTO import_batches(id,project_id,conversation_id,filename,content_hash,message_count,skipped_lines,utc_offset,imported_at,imported_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          batchId,
          projectId,
          conversationId,
          filename,
          parsed.contentHash,
          parsed.messageCount,
          parsed.skippedLines,
          input.utcOffset,
          now,
          actor.id,
        );
      this.store.db
        .prepare(
          "UPDATE projects SET revision=revision+?,updated_at=? WHERE id=?",
        )
        .run(parsed.messageCount, now, projectId);
      this.event(
        "conversation.imported",
        {
          projectId,
          conversationId,
          batchId,
          messageCount: parsed.messageCount,
        },
        now,
      );
      this.audit(
        actor.id,
        "conversation.imported",
        conversationId,
        { batchId, filename, messageCount: parsed.messageCount },
        now,
      );
    });
    return {
      duplicate: false,
      batchId,
      conversationId,
      messageCount: parsed.messageCount,
    };
  }
  listMessages(actor: Actor, projectId: string, limit = 100) {
    demand(this.allowed(actor, projectId), "FORBIDDEN", 403);
    demand(
      Number.isInteger(limit) && limit >= 1 && limit <= 500,
      "INVALID_LIMIT",
      400,
    );
    return this.store.db
      .prepare(
        "SELECT m.id,m.conversation_id,m.direction,m.text,m.sent_at,p.display_name sender_name,p.role sender_role FROM messages m LEFT JOIN participants p ON p.id=m.sender_id WHERE m.project_id=? AND m.text NOT IN ('[albumMessage]','[associatedChildMessage]','[messageContextInfo]','[protocolMessage]','[reactionMessage]','[senderKeyDistributionMessage]') ORDER BY m.sent_at DESC,m.id DESC LIMIT ?",
      )
      .all(projectId, limit)
      .reverse();
  }
  updateParticipantRole(
    actor: Actor,
    projectId: string,
    participantId: string,
    role: "client" | "team" | "unknown",
    now = new Date().toISOString(),
  ) {
    demand(
      actor.role !== "employee" && this.allowed(actor, projectId),
      "FORBIDDEN",
      403,
    );
    demand(
      ["client", "team", "unknown"].includes(role),
      "INVALID_PARTICIPANT_ROLE",
      400,
    );
    this.store.transaction(() => {
      const changed = this.store.db
        .prepare("UPDATE participants SET role=? WHERE id=? AND project_id=?")
        .run(role, participantId, projectId);
      demand(changed.changes === 1, "NOT_FOUND", 404);
      let changedMessages = 0;
      this.store.db.prepare("UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?").run(now, projectId);
      if (role !== "unknown")
        changedMessages = Number(
          this.store.db
            .prepare(
              "UPDATE messages SET direction=? WHERE sender_id=? AND project_id=?",
            )
            .run(
              role === "team" ? "outgoing" : "incoming",
              participantId,
              projectId,
            ).changes,
        );
      this.audit(
        actor.id,
        "participant.role_updated",
        participantId,
        { projectId, role, changedMessages },
        now,
      );
    });
  }
  createManualTask(
    actor: Actor,
    input: ManualTaskInput,
    now = new Date().toISOString(),
  ) {
    demand(
      actor.role !== "employee" && this.allowed(actor, input.projectId),
      "FORBIDDEN",
      403,
    );
    const title = text(input.title, "TASK_TITLE", 200, 2);
    const description = text(input.description, "TASK_DESCRIPTION", 10000, 3);
    demand(
      ["copy", "design", "page", "strategy", "service", "traffic"].includes(
        input.kind,
      ),
      "INVALID_TASK_KIND",
      400,
    );
    demand(
      ["low", "normal", "high", "urgent"].includes(input.priority),
      "INVALID_PRIORITY",
      400,
    );
    demand(
      input.evidenceIds.length > 0 && input.evidenceIds.length <= 20,
      "MISSING_EVIDENCE",
      400,
    );
    const evidenceIds = [...new Set(input.evidenceIds)];
    for (const evidenceId of evidenceIds)
      demand(
        this.store.db
          .prepare("SELECT 1 FROM messages WHERE id=? AND project_id=?")
          .get(evidenceId, input.projectId),
        "FOREIGN_EVIDENCE",
        400,
      );
    demand(
      input.dueAt === null || Number.isFinite(Date.parse(input.dueAt)),
      "INVALID_DATE",
      400,
    );
    let assigneeId = input.assigneeId;
    if (assigneeId) {
      demand(
        this.store.db
          .prepare(
            "SELECT 1 FROM employees e JOIN project_members m ON m.employee_id=e.id JOIN capabilities c ON c.employee_id=e.id WHERE e.id=? AND e.active=1 AND m.project_id=? AND c.kind=?",
          )
          .get(assigneeId, input.projectId, input.kind),
        "INVALID_ASSIGNEE",
        400,
      );
    } else {
      const candidates = this.store.db
        .prepare(
          "SELECT e.id FROM employees e JOIN project_members m ON m.employee_id=e.id JOIN capabilities c ON c.employee_id=e.id WHERE e.active=1 AND e.auto_assign=1 AND m.project_id=? AND c.kind=? ORDER BY e.id",
        )
        .all(input.projectId, input.kind);
      assigneeId = candidates.length === 1 ? String(candidates[0].id) : null;
    }
    const id = randomUUID();
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "INSERT INTO tasks(id,project_id,request_key,title,description,kind,priority,assignee_id,review_required,created_at,acknowledge_by,due_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          input.projectId,
          "manual:" + id,
          title,
          description,
          input.kind,
          input.priority,
          assigneeId,
          assigneeId ? 0 : 1,
          now,
          new Date(Date.parse(now) + 30 * 60000).toISOString(),
          input.dueAt ? new Date(input.dueAt).toISOString() : null,
        );
      for (const evidenceId of evidenceIds)
        this.store.db
          .prepare("INSERT INTO task_evidence(task_id,message_id) VALUES(?,?)")
          .run(id, evidenceId);
      this.event("task.created", { taskId: id }, now);
      this.audit(
        actor.id,
        "task.created",
        id,
        { mode: "manual", assigneeId },
        now,
      );
    });
    return { taskId: id, assigneeId, triage: !assigneeId };
  }
}
