import { randomUUID } from "node:crypto";
import { Store } from "../database/store.ts";
import { demand } from "./model.ts";
import type {
  Actor,
  Analysis,
  MessageInput,
  Task,
  TaskStatus,
} from "./model.ts";
export class WorkflowService {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  audit(
    actor: string,
    action: string,
    id: string,
    payload: unknown,
    now: string,
  ) {
    this.store.db
      .prepare(
        "INSERT INTO audit_logs(actor_id,action,entity_id,payload,created_at) VALUES(?,?,?,?,?)",
      )
      .run(actor, action, id, JSON.stringify(payload), now);
  }
  event(kind: string, payload: unknown, now: string) {
    this.store.db
      .prepare("INSERT INTO events(kind,payload,created_at) VALUES(?,?,?)")
      .run(kind, JSON.stringify(payload), now);
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
  ingest(
    m: MessageInput,
    now = new Date().toISOString(),
  ): { duplicate: boolean; revision: number } {
    demand(
      m.text.length <= 100000 && Number.isFinite(Date.parse(m.sentAt)),
      "INVALID_MESSAGE",
      400,
    );
    return this.store.transaction(() => {
      const project = this.store.db
        .prepare("SELECT revision FROM projects WHERE id=?")
        .get(m.projectId);
      demand(project, "PROJECT_NOT_FOUND", 404);
      const old = this.store.db
        .prepare(
          "SELECT * FROM messages WHERE account_id=? AND conversation_id=? AND external_id=?",
        )
        .get(m.accountId, m.conversationId, m.externalId);
      if (old) {
        demand(
          old.project_id === m.projectId &&
            old.text === m.text &&
            old.direction === m.direction &&
            old.sender_id === m.senderId,
          "MESSAGE_REQUIRES_REVISION",
        );
        return { duplicate: true, revision: Number(project.revision) };
      }
      this.store.db
        .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          m.id,
          m.accountId,
          m.externalId,
          m.projectId,
          m.conversationId,
          m.senderId,
          m.direction,
          m.text,
          m.sentAt,
          now,
          m.source,
        );
      this.store.db
        .prepare("UPDATE projects SET revision=revision+1 WHERE id=?")
        .run(m.projectId);
      const revision = Number(project.revision) + 1;
      if (m.source === "live")
        this.store.db
          .prepare(
            "INSERT INTO jobs(id,dedupe_key,kind,payload,state,available_at) VALUES(?,?,?,?,'pending',?)",
          )
          .run(
            randomUUID(),
            "analysis:" + m.projectId + ":" + revision,
            "analysis",
            JSON.stringify({ projectId: m.projectId, revision }),
            now,
          );
      this.event(
        "message.received",
        { messageId: m.id, source: m.source },
        now,
      );
      return { duplicate: false, revision };
    });
  }
  applyAnalysis(a: Analysis, now = new Date().toISOString()): string[] {
    return this.store.transaction(() => {
      const p = this.store.db
        .prepare("SELECT revision FROM projects WHERE id=?")
        .get(a.projectId);
      demand(p && Number(p.revision) === a.projectRevision, "STALE_ANALYSIS");
      const ids: string[] = [];
      for (const proposal of a.proposals) {
        demand(proposal.evidenceIds.length > 0, "MISSING_EVIDENCE", 400);
        for (const id of proposal.evidenceIds)
          demand(
            this.store.db
              .prepare("SELECT 1 FROM messages WHERE id=? AND project_id=?")
              .get(id, a.projectId),
            "FOREIGN_EVIDENCE",
            400,
          );
        demand(
          proposal.dueAt === null ||
            Number.isFinite(Date.parse(proposal.dueAt)),
          "INVALID_DATE",
          400,
        );
        const existing = this.store.db
          .prepare(
            "SELECT id FROM tasks WHERE project_id=? AND request_key=? AND status IN ('open','in_progress','blocked')",
          )
          .get(a.projectId, proposal.requestKey);
        if (existing) {
          for (const id of proposal.evidenceIds)
            this.store.db
              .prepare("INSERT OR IGNORE INTO task_evidence VALUES(?,?)")
              .run(existing.id!, id);
          ids.push(String(existing.id));
          continue;
        }
        const candidates = this.store.db
          .prepare(
            "SELECT e.id FROM employees e JOIN capabilities c ON c.employee_id=e.id JOIN project_members m ON m.employee_id=e.id WHERE e.active=1 AND e.auto_assign=1 AND c.kind=? AND m.project_id=? ORDER BY e.id",
          )
          .all(proposal.kind, a.projectId);
        const assignee =
          !proposal.needsReview && candidates.length === 1
            ? String(candidates[0].id)
            : null;
        const id = randomUUID();
        this.store.db
          .prepare(
            "INSERT INTO tasks(id,project_id,request_key,title,description,kind,priority,assignee_id,review_required,created_at,acknowledge_by,due_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            a.projectId,
            proposal.requestKey,
            proposal.title,
            proposal.description,
            proposal.kind,
            proposal.priority,
            assignee,
            assignee ? 0 : 1,
            now,
            new Date(Date.parse(now) + 30 * 60000).toISOString(),
            proposal.dueAt ? new Date(proposal.dueAt).toISOString() : null,
          );
        for (const evidence of new Set(proposal.evidenceIds))
          this.store.db
            .prepare("INSERT INTO task_evidence VALUES(?,?)")
            .run(id, evidence);
        this.event("task.created", { taskId: id }, now);
        this.audit(
          "system",
          "task.created",
          id,
          { assignee, mode: "proposal" },
          now,
        );
        ids.push(id);
      }
      this.store.db
        .prepare("UPDATE projects SET summary=?,summary_revision=? WHERE id=?")
        .run(a.summary, a.projectRevision, a.projectId);
      return ids;
    });
  }
  list(actor: Actor): Task[] {
    if (actor.role === "admin")
      return this.store.db
        .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
        .all() as unknown as Task[];
    if (actor.role === "manager")
      return this.store.db
        .prepare(
          "SELECT t.* FROM tasks t JOIN project_members m ON m.project_id=t.project_id WHERE m.employee_id=? ORDER BY t.created_at DESC",
        )
        .all(actor.id) as unknown as Task[];
    return this.store.db
      .prepare(
        "SELECT * FROM tasks WHERE assignee_id=? ORDER BY created_at DESC",
      )
      .all(actor.id) as unknown as Task[];
  }
  transition(
    actor: Actor,
    id: string,
    expectedVersion: number,
    status: TaskStatus,
    note: string,
    now = new Date().toISOString(),
  ) {
    return this.store.transaction(() => {
      const t = this.store.db
        .prepare("SELECT * FROM tasks WHERE id=?")
        .get(id) as unknown as Task | undefined;
      demand(t, "NOT_FOUND", 404);
      demand(
        this.allowed(actor, t.project_id) &&
          (actor.role !== "employee" || t.assignee_id === actor.id),
        "FORBIDDEN",
        403,
      );
      demand(t.version === expectedVersion, "VERSION_CONFLICT");
      const next: Record<TaskStatus, TaskStatus[]> = {
        open: ["in_progress", "cancelled"],
        in_progress: ["blocked", "done", "cancelled"],
        blocked: ["in_progress", "cancelled"],
        done: [],
        cancelled: [],
      };
      demand(next[t.status].includes(status), "INVALID_TRANSITION");
      demand(status !== "in_progress" || !t.review_required, "REVIEW_REQUIRED");
      demand(
        !["blocked", "done", "cancelled"].includes(status) ||
          note.trim().length >= 3,
        "REASON_REQUIRED",
        400,
      );
      this.store.db
        .prepare(
          "UPDATE tasks SET status=?,version=version+1,result=?,block_reason=? WHERE id=?",
        )
        .run(
          status,
          status === "done" ? note : t.result,
          status === "blocked" ? note : null,
          id,
        );
      this.audit(actor.id, "task." + status, id, { note }, now);
      this.event("task.changed", { taskId: id, status }, now);
    });
  }
  assign(
    actor: Actor,
    id: string,
    employeeId: string,
    expectedVersion: number,
    now = new Date().toISOString(),
  ) {
    demand(actor.role !== "employee", "FORBIDDEN", 403);
    this.store.transaction(() => {
      const t = this.store.db
        .prepare("SELECT * FROM tasks WHERE id=?")
        .get(id) as unknown as Task | undefined;
      demand(t, "NOT_FOUND", 404);
      demand(this.allowed(actor, t.project_id), "FORBIDDEN", 403);
      demand(t.version === expectedVersion, "VERSION_CONFLICT");
      demand(!["done", "cancelled"].includes(t.status), "TASK_CLOSED");
      demand(
        this.store.db
          .prepare(
            "SELECT 1 FROM project_members m JOIN employees e ON e.id=m.employee_id JOIN capabilities c ON c.employee_id=e.id WHERE m.project_id=? AND e.id=? AND e.active=1 AND c.kind=?",
          )
          .get(t.project_id, employeeId, t.kind),
        "INVALID_ASSIGNEE",
        400,
      );
      this.store.db
        .prepare(
          "UPDATE tasks SET assignee_id=?,review_required=0,version=version+1,acknowledge_by=? WHERE id=?",
        )
        .run(
          employeeId,
          new Date(Date.parse(now) + 30 * 60000).toISOString(),
          id,
        );
      this.audit(actor.id, "task.assigned", id, { employeeId }, now);
      this.event("task.assigned", { taskId: id }, now);
    });
  }
  notify(taskId: string, employeeId: string, kind: string, now: string) {
    this.store.db
      .prepare("INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,NULL)")
      .run(randomUUID(), employeeId, taskId, kind, now);
  }
  dispatch(now = new Date().toISOString()) {
    this.store.transaction(() => {
      const events = this.store.db
        .prepare(
          "SELECT * FROM events WHERE processed_at IS NULL ORDER BY id LIMIT 100",
        )
        .all();
      for (const e of events) {
        const payload = JSON.parse(String(e.payload));
        if (["task.created", "task.assigned", "task.updated"].includes(String(e.kind))) {
          const t = this.store.db
            .prepare("SELECT * FROM tasks WHERE id=?")
            .get(payload.taskId) as unknown as Task | undefined;
          if (t && !["done", "cancelled"].includes(t.status)) {
            if (t.assignee_id)
              this.notify(t.id, t.assignee_id, "assignment-v" + t.version, now);
            else
              for (const manager of this.store.db
                .prepare(
                  "SELECT id FROM employees WHERE role='admin' AND active=1 UNION SELECT e.id FROM employees e JOIN project_members m ON m.employee_id=e.id WHERE e.role='manager' AND e.active=1 AND m.project_id=?",
                )
                .all(t.project_id))
                this.notify(t.id, String(manager.id), "triage", now);
          }
        }
        this.store.db
          .prepare("UPDATE events SET processed_at=? WHERE id=?")
          .run(now, e.id!);
      }
    });
  }
  escalate(now = new Date().toISOString()) {
    this.store.transaction(() => {
      const tasks = this.store.db
        .prepare(
          "SELECT * FROM tasks WHERE status IN ('open','in_progress','blocked') AND ((status='open' AND acknowledge_by<=?) OR due_at<=?)",
        )
        .all(now, now) as unknown as Task[];
      for (const t of tasks) {
        const kind = t.due_at && t.due_at <= now ? "overdue" : "unacknowledged";
        if (t.assignee_id)
          this.notify(t.id, t.assignee_id, kind + "-v" + t.version, now);
        for (const e of this.store.db
          .prepare(
            "SELECT id FROM employees WHERE role='admin' AND active=1 UNION SELECT e.id FROM employees e JOIN project_members m ON m.employee_id=e.id WHERE e.role='manager' AND e.active=1 AND m.project_id=?",
          )
          .all(t.project_id))
          this.notify(t.id, String(e.id), kind + "-v" + t.version, now);
      }
    });
  }
}
