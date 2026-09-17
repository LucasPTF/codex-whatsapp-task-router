import { randomUUID } from "node:crypto";
import type { Store } from "../database/store.ts";
import { AnalysisService } from "./analysis-service.ts";
import { DomainError, demand } from "./model.ts";
import type { Actor } from "./model.ts";

const messagesPerBatch = 25;
const batchesPerTick = 3;
const maximumAttempts = 3;
const clientResponseSlaHours = 24;
const duplicateLookbackMs = 24 * 60 * 60 * 1000;
const duplicateConversationGapMs = 15 * 60 * 1000;

const ignoredTopicWords = new Set([
  "a",
  "ao",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "um",
  "uma",
]);

type PendingProposalRow = {
  id: string;
  analysis_run_id: string;
  project_id: string;
  request_key: string;
  title: string;
  description: string;
  kind: string;
  priority: string;
  due_at: string | null;
  evidence_ids: string;
  needs_review: number;
  operation: string;
  created_at: string;
};

function topicTokens(value: string) {
  return new Set(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((word) => word.length > 1 && !ignoredTopicWords.has(word))
      .map((word) => (word.length > 6 ? word.slice(0, 6) : word)) ?? [],
  );
}

function topicSimilarity(left: string, right: string) {
  const leftTokens = topicTokens(left);
  const rightTokens = topicTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function priorityRank(value: string) {
  return ["low", "normal", "high", "urgent"].indexOf(value);
}

function combineDistinct(primary: string, complement: string, limit: number) {
  if (primary.trim() === complement.trim()) return primary.slice(0, limit);
  return `${primary.trim()}\n\nComplemento consolidado: ${complement.trim()}`.slice(
    0,
    limit,
  );
}

function combineTitles(primary: string, complement: string) {
  if (primary.trim() === complement.trim()) return primary.slice(0, 200);
  const second = complement.trim();
  return `${primary.trim()}; ${second.charAt(0).toLowerCase()}${second.slice(1)}`.slice(
    0,
    200,
  );
}

type BatchRow = {
  id: string;
  project_id: string;
  new_message_ids: string;
  attempts: number;
  chunk_index: number;
};

function errorCode(error: unknown) {
  const value =
    error instanceof DomainError
      ? error.code
      : error instanceof Error
        ? error.message
        : "AUTOMATIC_ANALYSIS_FAILED";
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(value)
    ? value
    : "AUTOMATIC_ANALYSIS_FAILED";
}

export class AutomaticAnalysisCoordinator {
  private readonly store: Store;
  private readonly analyzer: AnalysisService;
  private processing = false;

  constructor(store: Store, analyzer: AnalysisService) {
    this.store = store;
    this.analyzer = analyzer;
    this.store.db
      .prepare(
        "UPDATE whatsapp_analysis_batches SET status='pending',analysis_run_id=NULL,error_code='SERVER_RESTARTED',started_at=NULL WHERE status='running'",
      )
      .run();
    this.recoverSuccessfulSyncs();
    this.consolidatePendingProposals();
  }

  private audit(
    action: string,
    entityId: string,
    payload: unknown,
    now: string,
  ) {
    this.store.db
      .prepare(
        "INSERT INTO audit_logs(actor_id,action,entity_id,payload,created_at) VALUES('system',?,?,?,?)",
      )
      .run(action, entityId, JSON.stringify(payload), now);
  }

  recoverSuccessfulSyncs(now = new Date().toISOString()) {
    this.store.db.prepare("UPDATE whatsapp_analysis_batches SET status='succeeded',finished_at=COALESCE(finished_at,?) WHERE status='needs_review' AND NOT EXISTS (SELECT 1 FROM analysis_proposals a WHERE a.analysis_run_id=whatsapp_analysis_batches.analysis_run_id AND a.status='pending')").run(now);
    const runs = this.store.db
      .prepare(
        "SELECT DISTINCT r.id FROM whatsapp_sync_runs r JOIN whatsapp_raw_messages m ON m.sync_run_id=r.id WHERE r.status='succeeded' AND r.mode='incremental' AND NOT EXISTS (SELECT 1 FROM audit_logs l WHERE l.action='analysis.automatic_sync_reconciled' AND l.entity_id=r.id)",
      )
      .all();
    let queued = 0;
    for (const run of runs) queued += this.enqueueForSync(String(run.id), now);
    return queued;
  }

  enqueueForSync(syncRunId: string, now = new Date().toISOString()) {
    const sync = this.store.db
      .prepare("SELECT id,status,mode FROM whatsapp_sync_runs WHERE id=?")
      .get(syncRunId);
    if (!sync || sync.status !== "succeeded" || sync.mode !== "incremental")
      return 0;
    const rows = this.store.db
      .prepare(
        "SELECT DISTINCT m.id,m.project_id,m.sent_at FROM whatsapp_raw_messages r JOIN whatsapp_raw_chats c ON c.account_id=r.account_id AND c.conversation_id=r.conversation_id JOIN projects p ON p.id=c.project_id JOIN messages m ON m.account_id=r.account_id AND m.conversation_id=c.live_conversation_id AND m.project_id=c.project_id AND m.external_id=r.external_id WHERE r.sync_run_id=? AND TRIM(r.text)<>'' AND r.message_type NOT IN ('unknown','secretEncryptedMessage','albumMessage','associatedChildMessage','messageContextInfo','protocolMessage','reactionMessage','senderKeyDistributionMessage') AND c.mapping_state='mapped' AND p.active=1 ORDER BY m.project_id,m.sent_at,m.id",
      )
      .all(syncRunId);
    const byProject = new Map<string, string[]>();
    for (const row of rows) {
      const projectId = String(row.project_id);
      const ids = byProject.get(projectId) ?? [];
      ids.push(String(row.id));
      byProject.set(projectId, ids);
    }
    let queued = 0;
    this.store.transaction(() => {
      const insert = this.store.db.prepare(
        "INSERT OR IGNORE INTO whatsapp_analysis_batches(id,sync_run_id,project_id,chunk_index,new_message_ids,new_message_count,created_at) VALUES(?,?,?,?,?,?,?)",
      );
      for (const [projectId, ids] of byProject) {
        for (let offset = 0; offset < ids.length; offset += messagesPerBatch) {
          const chunk = ids.slice(offset, offset + messagesPerBatch);
          const chunkIndex = Math.floor(offset / messagesPerBatch);
          const id = randomUUID();
          const result = insert.run(
            id,
            syncRunId,
            projectId,
            chunkIndex,
            JSON.stringify(chunk),
            chunk.length,
            now,
          );
          if (result.changes) {
            queued += 1;
            this.audit(
              "analysis.automatic_batch_queued",
              id,
              { syncRunId, projectId, newMessageCount: chunk.length },
              now,
            );
          }
        }
      }
      const alreadyReconciled = this.store.db
        .prepare(
          "SELECT 1 found FROM audit_logs WHERE action='analysis.automatic_sync_reconciled' AND entity_id=? LIMIT 1",
        )
        .get(syncRunId);
      if (!alreadyReconciled)
        this.audit(
          "analysis.automatic_sync_reconciled",
          syncRunId,
          { queued },
          now,
        );
    });
    return queued;
  }

  enqueueHistoricalRecovery(accountId: string, now = new Date().toISOString()) {
    const sync = this.store.db.prepare("SELECT id,requested_from FROM whatsapp_sync_runs WHERE account_id=? AND status='succeeded' ORDER BY started_at LIMIT 1").get(accountId);
    if (!sync) return 0;
    const since = new Date(String(sync.requested_from));
    const projects = this.store.db.prepare("SELECT DISTINCT p.id FROM projects p JOIN whatsapp_raw_chats c ON c.project_id=p.id WHERE p.active=1 AND c.account_id=? AND c.mapping_state='mapped'").all(accountId);
    let queued = 0;
    for (const project of projects) {
      this.store.transaction(() => {
        const marker = `recovery-v2:${accountId}:${project.id}`;
        const rows = this.store.db.prepare("SELECT m.id,m.text FROM messages m WHERE m.project_id=? AND m.sent_at>=? AND m.sent_at<=? AND TRIM(m.text)<>'' AND m.text NOT IN ('[unknown]','[secretEncryptedMessage]','[protocolMessage]','[reactionMessage]','[senderKeyDistributionMessage]','[albumMessage]','[associatedChildMessage]','[messageContextInfo]') AND EXISTS (SELECT 1 FROM whatsapp_raw_chats c WHERE c.account_id=m.account_id AND c.live_conversation_id=m.conversation_id AND c.mapping_state='mapped') AND NOT EXISTS (SELECT 1 FROM whatsapp_analysis_batches b,json_each(b.new_message_ids) j WHERE b.project_id=m.project_id AND j.value=m.id) ORDER BY m.sent_at,m.id").all(project.id, since.toISOString(), now);
        if (!rows.length) return;
        let chunk: string[] = [];
        let bytes = 0;
        let index = Number(this.store.db.prepare("SELECT COALESCE(MIN(chunk_index),0) lowest FROM whatsapp_analysis_batches WHERE sync_run_id=? AND project_id=?").get(sync.id, project.id)!.lowest) - 1;
        const flush = () => {
          if (!chunk.length) return;
          this.store.db.prepare("INSERT INTO whatsapp_analysis_batches(id,sync_run_id,project_id,chunk_index,new_message_ids,new_message_count,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(), sync.id, project.id, index--, JSON.stringify(chunk), chunk.length, now);
          queued++;
          chunk = [];
          bytes = 0;
        };
        for (const row of rows) {
          const size = Buffer.byteLength(JSON.stringify(String(row.text).slice(0, 6000))) + 1000;
          if (chunk.length >= 100 || bytes + size > 120000) flush();
          chunk.push(String(row.id));
          bytes += size;
        }
        flush();
        this.audit("analysis.history_queued", marker, { projectId: project.id, since: since.toISOString(), through: now, messages: rows.length }, now);
      });
    }
    return queued;
  }

  private actor(projectId: string): Actor | null {
    const admin = this.store.db
      .prepare(
        "SELECT id,role FROM employees WHERE active=1 AND role='admin' ORDER BY id LIMIT 1",
      )
      .get();
    if (admin)
      return { id: String(admin.id), role: admin.role as Actor["role"] };
    const manager = this.store.db
      .prepare(
        "SELECT e.id,e.role FROM employees e JOIN project_members m ON m.employee_id=e.id WHERE e.active=1 AND e.role='manager' AND m.project_id=? ORDER BY e.id LIMIT 1",
      )
      .get(projectId);
    return manager
      ? { id: String(manager.id), role: manager.role as Actor["role"] }
      : null;
  }

  private hasSingleAutomaticAssignee(projectId: string, kind: string) {
    return (
      this.store.db
        .prepare(
          "SELECT COUNT(DISTINCT e.id) count FROM employees e JOIN project_members m ON m.employee_id=e.id JOIN capabilities c ON c.employee_id=e.id WHERE e.active=1 AND e.auto_assign=1 AND m.project_id=? AND c.kind=?",
        )
        .get(projectId, kind)!.count === 1
    );
  }

  private finishBatch(
    batchId: string,
    status: "succeeded" | "needs_review",
    now = new Date().toISOString(),
  ) {
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "UPDATE whatsapp_analysis_batches SET status=?,finished_at=?,error_code=NULL WHERE id=? AND status='running'",
        )
        .run(status, now, batchId);
      this.audit("analysis.automatic_batch_finished", batchId, { status }, now);
    });
  }

  private retryOrFail(
    batch: BatchRow,
    code: string,
    now = new Date().toISOString(),
  ) {
    const retry = Number(batch.attempts) < maximumAttempts;
    this.store.db
      .prepare(
        retry
          ? "UPDATE whatsapp_analysis_batches SET status='pending',analysis_run_id=NULL,error_code=?,started_at=NULL,available_at=? WHERE id=?"
          : "UPDATE whatsapp_analysis_batches SET status='failed',error_code=?,finished_at=? WHERE id=?",
      )
      .run(...(retry ? [code, new Date(Date.parse(now) + Math.min(30, 2 ** batch.attempts) * 60000).toISOString(), batch.id] : [code, now, batch.id]));
  }

  private async process(batch: BatchRow) {
    const startedAt = new Date().toISOString();
    const claimed = this.store.db
      .prepare(
        "UPDATE whatsapp_analysis_batches SET status='running',attempts=attempts+1,started_at=?,finished_at=NULL WHERE id=? AND status='pending'",
      )
      .run(startedAt, batch.id);
    if (!claimed.changes) return;
    const claimedBatch = {
      ...batch,
      attempts: Number(batch.attempts) + 1,
    };
    try {
      if (!this.store.db.prepare("SELECT 1 FROM projects WHERE id=? AND active=1").get(batch.project_id)) {
        this.finishBatch(batch.id, "succeeded");
        return;
      }
      const actor = this.actor(batch.project_id);
      if (!actor) throw new Error("AUTOMATIC_ANALYSIS_ACTOR_MISSING");
      const parsed = JSON.parse(batch.new_message_ids) as unknown;
      demand(
        Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.length <= (batch.chunk_index < 0 ? 100 : messagesPerBatch) &&
          parsed.every((value) => typeof value === "string"),
        "INVALID_AUTOMATIC_BATCH",
        500,
      );
      const eligibleIds = (parsed as string[]).filter((id) => this.store.db.prepare("SELECT 1 FROM messages m JOIN whatsapp_raw_chats c ON c.account_id=m.account_id AND c.live_conversation_id=m.conversation_id WHERE m.id=? AND c.mapping_state='mapped'").get(id));
      if (!eligibleIds.length) { this.finishBatch(batch.id, "succeeded"); return; }
      const started = this.analyzer.start(actor, batch.project_id, startedAt, {
        focusMessageIds: eligibleIds,
        mode: batch.chunk_index < 0 ? "recovery" : "incremental",
      }) as unknown as { id: string };
      this.store.db
        .prepare(
          "UPDATE whatsapp_analysis_batches SET analysis_run_id=? WHERE id=? AND status='running'",
        )
        .run(started.id, batch.id);
      await this.analyzer.wait(started.id);
      const run = this.store.db
        .prepare("SELECT status,error_code FROM analysis_runs WHERE id=?")
        .get(started.id);
      if (!run || run.status !== "succeeded") {
        this.retryOrFail(
          claimedBatch,
          run?.status === "stale"
            ? "STALE_ANALYSIS"
            : String(run?.error_code ?? "AUTOMATIC_ANALYSIS_FAILED"),
        );
        return;
      }
      this.consolidatePendingProposals();
      const proposals = this.store.db
        .prepare(
          "SELECT id,kind,needs_review FROM analysis_proposals WHERE analysis_run_id=? AND status='pending' ORDER BY rowid",
        )
        .all(started.id);
      for (const proposal of proposals) {
        if (
          Number(proposal.needs_review) ||
          !this.hasSingleAutomaticAssignee(
            batch.project_id,
            String(proposal.kind),
          )
        )
          continue;
        this.analyzer.reviewProposal(actor, String(proposal.id), "approve");
      }
      const pending = Number(
        this.store.db
          .prepare(
            "SELECT COUNT(*) count FROM analysis_proposals WHERE analysis_run_id=? AND status='pending'",
          )
          .get(started.id)!.count,
      );
      this.finishBatch(batch.id, pending ? "needs_review" : "succeeded");
    } catch (error) {
      const code = errorCode(error);
      if (code === "ANALYSIS_ALREADY_RUNNING") {
        this.store.db
          .prepare(
            "UPDATE whatsapp_analysis_batches SET status='pending',attempts=MAX(attempts-1,0),started_at=NULL,error_code=? WHERE id=?",
          )
          .run(code, batch.id);
        return;
      }
      this.retryOrFail(claimedBatch, code);
    }
  }

  async tick() {
    if (this.processing || this.analyzer.status().state !== "ready") return;
    this.processing = true;
    try {
      this.recoverSuccessfulSyncs();
      for (let index = 0; index < batchesPerTick; index += 1) {
        if(this.analyzer.status().state !== 'ready') break;
        const batch = this.store.db
          .prepare(
        "SELECT id,project_id,new_message_ids,attempts,chunk_index FROM whatsapp_analysis_batches WHERE status='pending' AND (available_at IS NULL OR available_at<=?) ORDER BY CASE WHEN chunk_index>=0 THEN 0 ELSE 1 END,created_at,project_id,chunk_index DESC,id LIMIT 1",
          )
          .get(new Date().toISOString()) as unknown as BatchRow | undefined;
        if (!batch) break;
        await this.process(batch);
      }
    } finally {
      this.processing = false;
    }
  }

  consolidatePendingProposals(now = new Date().toISOString()) {
    const proposals = this.store.db
      .prepare(
        "SELECT a.id,a.analysis_run_id,r.project_id,a.request_key,a.title,a.description,a.kind,a.priority,a.due_at,a.evidence_ids,a.needs_review,a.operation,r.created_at FROM analysis_proposals a JOIN analysis_runs r ON r.id=a.analysis_run_id WHERE a.status='pending' ORDER BY r.project_id,r.created_at,a.rowid",
      )
      .all() as unknown as PendingProposalRow[];
    const evidenceWindow = (proposal: PendingProposalRow) => {
      const parsed = JSON.parse(proposal.evidence_ids) as unknown;
      const ids = Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [];
      if (!ids.length) return null;
      const row = this.store.db
        .prepare(
          `SELECT MIN(sent_at) first_sent_at,MAX(sent_at) last_sent_at FROM messages WHERE id IN (${ids.map(() => "?").join(",")})`,
        )
        .get(...ids);
      return row?.first_sent_at && row?.last_sent_at
        ? {
            first: Date.parse(String(row.first_sent_at)),
            last: Date.parse(String(row.last_sent_at)),
          }
        : null;
    };
    const active = [...proposals];
    let merged = 0;
    for (
      let primaryIndex = 0;
      primaryIndex < active.length;
      primaryIndex += 1
    ) {
      const primary = active[primaryIndex];
      for (
        let duplicateIndex = primaryIndex + 1;
        duplicateIndex < active.length;

      ) {
        const duplicate = active[duplicateIndex];
        if (primary.project_id !== duplicate.project_id || primary.operation !== 'upsert' || duplicate.operation !== 'upsert') {
          duplicateIndex += 1;
          continue;
        }
        const createdGap =
          Date.parse(duplicate.created_at) - Date.parse(primary.created_at);
        const primaryWindow = evidenceWindow(primary);
        const duplicateWindow = evidenceWindow(duplicate);
        const conversationGap =
          primaryWindow && duplicateWindow
            ? Math.max(
                0,
                duplicateWindow.first - primaryWindow.last,
                primaryWindow.first - duplicateWindow.last,
              )
            : Number.POSITIVE_INFINITY;
        const similarity = topicSimilarity(primary.title, duplicate.title);
        const sameIntentKey = primary.request_key === duplicate.request_key;
        const compatibleTopic =
          (primary.kind === duplicate.kind && similarity >= 0.2) ||
          ([primary.kind, duplicate.kind].every((kind) => ["copy", "service"].includes(kind)) && similarity >= 0.4);
        if (
          createdGap < 0 ||
          createdGap > duplicateLookbackMs ||
          (!sameIntentKey &&
            (conversationGap > duplicateConversationGapMs || !compatibleTopic))
        ) {
          duplicateIndex += 1;
          continue;
        }
        const primaryEvidence = JSON.parse(primary.evidence_ids) as string[];
        const duplicateEvidence = JSON.parse(
          duplicate.evidence_ids,
        ) as string[];
        const evidenceIds = [
          ...new Set([...primaryEvidence, ...duplicateEvidence]),
        ];
        const title = combineTitles(primary.title, duplicate.title);
        const description = combineDistinct(
          primary.description,
          duplicate.description,
          10_000,
        );
        const priority =
          priorityRank(duplicate.priority) > priorityRank(primary.priority)
            ? duplicate.priority
            : primary.priority;
        const dueAt =
          [primary.due_at, duplicate.due_at]
            .filter((value): value is string => Boolean(value))
            .sort()[0] ?? null;
        this.store.transaction(() => {
          this.store.db
            .prepare(
              "UPDATE analysis_proposals SET title=?,description=?,priority=?,due_at=?,evidence_ids=?,needs_review=? WHERE id=? AND status='pending'",
            )
            .run(
              title,
              description,
              priority,
              dueAt,
              JSON.stringify(evidenceIds),
              Math.max(primary.needs_review, duplicate.needs_review),
              primary.id,
            );
          this.store.db
            .prepare(
              "UPDATE analysis_proposals SET status='rejected',reviewed_at=? WHERE id=? AND status='pending'",
            )
            .run(now, duplicate.id);
          this.audit(
            "analysis.proposal_consolidated",
            primary.id,
            {
              duplicateProposalId: duplicate.id,
              projectId: primary.project_id,
              similarity,
              conversationGapMs: conversationGap,
              evidenceCount: evidenceIds.length,
            },
            now,
          );
          const remaining = Number(
            this.store.db
              .prepare(
                "SELECT COUNT(*) count FROM analysis_proposals WHERE analysis_run_id=? AND status='pending'",
              )
              .get(duplicate.analysis_run_id)!.count,
          );
          if (!remaining)
            this.store.db
              .prepare(
                "UPDATE whatsapp_analysis_batches SET status='succeeded',finished_at=COALESCE(finished_at,?) WHERE analysis_run_id=? AND status='needs_review'",
              )
              .run(now, duplicate.analysis_run_id);
        });
        primary.title = title;
        primary.description = description;
        primary.priority = priority;
        primary.due_at = dueAt;
        primary.evidence_ids = JSON.stringify(evidenceIds);
        primary.needs_review = Math.max(
          primary.needs_review,
          duplicate.needs_review,
        );
        active.splice(duplicateIndex, 1);
        merged += 1;
      }
    }
    return merged;
  }

  list(actor: Actor) {
    demand(actor.role !== "employee", "FORBIDDEN", 403);
    const scope =
      actor.role === "admin"
        ? ""
        : " AND EXISTS (SELECT 1 FROM project_members member WHERE member.project_id=b.project_id AND member.employee_id=?)";
    const parameters = actor.role === "admin" ? [] : [actor.id];
    const batches = this.store.db
      .prepare(
        `SELECT b.id,b.project_id,p.name project_name,b.status,b.new_message_count,b.attempts,b.error_code,b.created_at,b.finished_at,r.summary FROM whatsapp_analysis_batches b JOIN projects p ON p.id=b.project_id LEFT JOIN analysis_runs r ON r.id=b.analysis_run_id WHERE 1=1${scope} ORDER BY b.created_at DESC,b.id DESC LIMIT 100`,
      )
      .all(...parameters);
    const proposalRows = this.store.db
      .prepare(
        `SELECT a.id,a.title,a.description,a.kind,a.operation,a.priority,a.due_at,a.evidence_ids,a.needs_review,b.id batch_id,b.new_message_ids,b.project_id,p.name project_name FROM analysis_proposals a JOIN whatsapp_analysis_batches b ON b.analysis_run_id=a.analysis_run_id JOIN projects p ON p.id=b.project_id WHERE a.status='pending'${scope} ORDER BY b.created_at,a.rowid`,
      )
      .all(...parameters);
    const proposals = proposalRows.map((proposal) => {
      const batchId = String(proposal.batch_id);
      const evidenceIds = JSON.parse(String(proposal.evidence_ids)) as string[];
      const timingRow = evidenceIds.length
        ? this.store.db
            .prepare(
              `SELECT MIN(m.sent_at) first_sent_at,MAX(m.sent_at) last_sent_at,COUNT(*) message_count FROM messages m JOIN participants participant ON participant.id=m.sender_id WHERE m.id IN (${evidenceIds.map(() => "?").join(",")}) AND m.direction='incoming' AND participant.role='client'`,
            )
            .get(...evidenceIds)
        : null;
      const firstSentAt = timingRow?.first_sent_at
        ? String(timingRow.first_sent_at)
        : null;
      const responseDueAt = firstSentAt
        ? new Date(
            new Date(firstSentAt).getTime() +
              clientResponseSlaHours * 60 * 60 * 1000,
          ).toISOString()
        : null;
      return {
        id: String(proposal.id),
        title: String(proposal.title),
        description: String(proposal.description),
        kind: String(proposal.kind),
        operation: String(proposal.operation),
        priority: String(proposal.priority),
        due_at: proposal.due_at ? String(proposal.due_at) : null,
        needs_review: Number(proposal.needs_review),
        batch_id: batchId,
        project_id: String(proposal.project_id),
        project_name: String(proposal.project_name),
        evidenceIds,
        client_message_first_sent_at: firstSentAt,
        client_message_last_sent_at: timingRow?.last_sent_at
          ? String(timingRow.last_sent_at)
          : null,
        client_message_count: Number(timingRow?.message_count ?? 0),
        client_response_due_at: responseDueAt,
        client_response_sla_hours: clientResponseSlaHours,
      };
    });
    return {
      analyzer: this.analyzer.status(),
      batches,
      proposals,
      counts: Object.fromEntries(
        ["pending", "running", "needs_review", "failed"].map((status) => [
          status,
          Number(this.store.db.prepare(`SELECT COUNT(*) count FROM whatsapp_analysis_batches b WHERE b.status=?${scope}`).get(status, ...parameters)!.count),
        ]),
      ),
    };
  }

  retryFailed(actor: Actor, now = new Date().toISOString()) {
    demand(actor.role !== "employee", "FORBIDDEN", 403);
    this.analyzer.resume();
    return this.store.transaction(() => {
      const scope = actor.role === 'admin' ? '' : ' AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=whatsapp_analysis_batches.project_id AND m.employee_id=?)';
      const result = this.store.db.prepare(`UPDATE whatsapp_analysis_batches SET status='pending',attempts=0,error_code=NULL,analysis_run_id=NULL,started_at=NULL,finished_at=NULL,available_at=NULL WHERE status='failed'${scope}`).run(...(actor.role === 'admin' ? [] : [actor.id]));
      this.audit('analysis.failed_batches_requeued', actor.id, { count: Number(result.changes) }, now);
      return { queued: Number(result.changes) };
    });
  }

  reanalyzeProposal(actor: Actor, proposalId: string, now = new Date().toISOString()) {
    demand(actor.role !== 'employee','FORBIDDEN',403);
    const row=this.store.db.prepare("SELECT a.evidence_ids,b.project_id,b.sync_run_id FROM analysis_proposals a JOIN whatsapp_analysis_batches b ON b.analysis_run_id=a.analysis_run_id WHERE a.id=? AND a.status='pending'").get(proposalId);
    demand(row,'PROPOSAL_NOT_FOUND',404);
    demand(actor.role==='admin' || this.store.db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND employee_id=?').get(row.project_id,actor.id),'FORBIDDEN',403);
    demand(!this.store.db.prepare("SELECT 1 FROM whatsapp_analysis_batches WHERE project_id=? AND status IN ('pending','running')").get(row.project_id),'PROJECT_ANALYSIS_QUEUED',409);
    const ids=JSON.parse(String(row.evidence_ids)) as string[];
    return this.store.transaction(()=>{
      let index=Number(this.store.db.prepare('SELECT COALESCE(MIN(chunk_index),0)-1 next FROM whatsapp_analysis_batches WHERE project_id=? AND sync_run_id=?').get(row.project_id,row.sync_run_id)!.next);
      for(let offset=0;offset<ids.length;offset+=100) {
        const chunk=ids.slice(offset,offset+100);
        this.store.db.prepare('INSERT INTO whatsapp_analysis_batches(id,sync_run_id,project_id,chunk_index,new_message_ids,new_message_count,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),row.sync_run_id,row.project_id,index--,JSON.stringify(chunk),chunk.length,now);
      }
      this.audit('analysis.proposal_reanalysis_queued',proposalId,{actorId:actor.id},now);
      return {queued:Math.ceil(ids.length/100)};
    });
  }

  reconcileProposal(proposalId: string) {
    const batch = this.store.db
      .prepare(
        "SELECT b.id,b.analysis_run_id FROM whatsapp_analysis_batches b JOIN analysis_proposals a ON a.analysis_run_id=b.analysis_run_id WHERE a.id=?",
      )
      .get(proposalId);
    if (!batch) return;
    const pending = Number(
      this.store.db
        .prepare(
          "SELECT COUNT(*) count FROM analysis_proposals WHERE analysis_run_id=? AND status='pending'",
        )
        .get(batch.analysis_run_id)!.count,
    );
    if (!pending)
      this.store.db
        .prepare(
          "UPDATE whatsapp_analysis_batches SET status='succeeded',finished_at=COALESCE(finished_at,?) WHERE id=? AND status='needs_review'",
        )
        .run(new Date().toISOString(), batch.id);
  }
}
