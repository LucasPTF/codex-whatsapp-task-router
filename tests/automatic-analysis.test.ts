import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDemo } from "../apps/server/src/auth.ts";
import { AnalysisService } from "../packages/core/analysis-service.ts";
import { AutomaticAnalysisCoordinator } from "../packages/core/automatic-analysis.ts";
import { WorkflowService } from "../packages/core/service.ts";
import type { RunSpec } from "../packages/codex-adapter/transport.ts";
import { Store } from "../packages/database/store.ts";
import type { WhatsAppConnectorMessage } from "../packages/whatsapp/connector.ts";
import { WhatsAppOnboarding } from "../packages/whatsapp/onboarding.ts";
import { WhatsAppRawInbox } from "../packages/whatsapp/raw-inbox.ts";
import { WhatsAppSyncState } from "../packages/whatsapp/sync.ts";

function connectorMessage(
  externalId: string,
  text: string,
  sentAt: string,
): WhatsAppConnectorMessage {
  return {
    accountId: "primary",
    externalId,
    conversationId: "automatico@g.us",
    conversationTitle: "401) Cliente automático [T SET] [20%]",
    isGroup: true,
    senderId: "12025550199@s.whatsapp.net",
    senderName: "Cliente",
    direction: "incoming",
    text,
    sentAt,
    messageType: "conversation",
    hasMedia: false,
  };
}

function executor(needsReview: boolean, kind: "copy" | "traffic") {
  return async (spec: RunSpec) => {
    const encoded = spec.prompt.match(
      /SNAPSHOT_JSON_BEGIN\n([\s\S]+)\nSNAPSHOT_JSON_END/,
    )?.[1];
    assert(encoded);
    const snapshot = JSON.parse(encoded) as {
      projectId: string;
      projectRevision: number;
      focus: { mode: string; newMessageIds: string[] };
      messages: { id: string; isNew: boolean; text: string }[];
    };
    assert.equal(snapshot.focus.mode, "incremental");
    assert.equal(snapshot.focus.newMessageIds.length, 1);
    const focused = snapshot.messages.filter((message) => message.isNew);
    assert.equal(focused.length, 1);
    assert.match(focused[0].text, /pixel|copy/u);
    assert(
      snapshot.messages.some(
        (message) => !message.isNew && message.text.includes("Contexto antigo"),
      ),
    );
    writeFileSync(
      spec.outputPath,
      JSON.stringify({
        projectId: snapshot.projectId,
        projectRevision: snapshot.projectRevision,
        summary: "Uma nova demanda foi encontrada.",
        messageDecisions: focused.map((message) => ({messageId:message.id,outcome:needsReview?'review':'demand',requestKeys:[`${kind}-automatico-1`],reason:'Pedido explícito da fixture.'})),
        proposals: [
          {
            operation: 'upsert',
            expectedTaskVersion: null,
            requestKey: `${kind}-automatico-1`,
            title: kind === "traffic" ? "Revisar pixel" : "Revisar copy",
            description: "Pedido presente na nova mensagem.",
            kind,
            priority: "high",
            dueAt: null,
            evidenceIds: [focused[0].id],
            needsReview,
          },
        ],
      }),
    );
    return { exitCode: 0, jsonl: '{"type":"thread.started"}\n' };
  };
}

function setupAutomatic(needsReview: boolean, kind: "copy" | "traffic") {
  const directory = mkdtempSync(join(tmpdir(), "controle-auto-analysis-"));
  const store = new Store();
  seedDemo(store);
  const inbox = new WhatsAppRawInbox(store);
  const sync = new WhatsAppSyncState(store);
  const initial = sync.start("primary", "2026-09-15T12:00:00.000Z");
  inbox.ingest(
    connectorMessage(
      "old-1",
      "Contexto antigo do cliente.",
      "2026-09-15T11:00:00.000Z",
    ),
    "2026-09-15T12:00:01.000Z",
    initial.id,
  );
  sync.succeed(initial.id, { imported: 1, duplicates: 0 });
  const onboarding = new WhatsAppOnboarding(store, "primary", true);
  const mapped = onboarding.mapGroup(
    { id: "gestor", role: "admin" },
    "automatico@g.us",
    [],
    "2026-09-15T12:01:00.000Z",
  );
  const incremental = sync.start("primary", "2026-09-15T17:00:00.000Z");
  inbox.ingest(
    connectorMessage(
      "new-1",
      kind === "traffic"
        ? "Precisamos revisar o pixel hoje."
        : "Precisamos revisar a copy hoje.",
      "2026-09-15T16:55:00.000Z",
    ),
    "2026-09-15T17:00:01.000Z",
    incremental.id,
  );
  sync.succeed(incremental.id, { imported: 1, duplicates: 0 });
  const analyzer = new AnalysisService(store, {
    enabled: true,
    executable: process.execPath,
    workspaceRoot: directory,
    timeoutMs: 30_000,
    execute: executor(needsReview, kind),
  });
  const automatic = new AutomaticAnalysisCoordinator(store, analyzer);
  return {
    directory,
    store,
    analyzer,
    automatic,
    projectId: mapped.projectId,
    syncRunId: incremental.id,
  };
}

test("recuperação inclui histórico sem sync, cobre todos os IDs e não repete após reinício", async () => {
  const context = setupAutomatic(false, "traffic");
  try {
    const inbox = new WhatsAppRawInbox(context.store);
    for (let index = 0; index < 205; index++)
      inbox.ingest(connectorMessage(`history-${index}`, `Escolha e contexto ${index}`, "2026-09-14T10:00:00.000Z"));
    assert.equal(context.automatic.enqueueHistoricalRecovery("primary", "2026-09-16T00:00:00.000Z"), 3);
    const rows = context.store.db.prepare("SELECT new_message_ids FROM whatsapp_analysis_batches WHERE chunk_index<0").all();
    const ids = rows.flatMap((row) => JSON.parse(String(row.new_message_ids)) as string[]);
    assert.equal(ids.length, 206);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(context.automatic.enqueueHistoricalRecovery("primary", "2026-09-16T00:00:00.000Z"), 0);
    const restarted = new AutomaticAnalysisCoordinator(context.store, context.analyzer);
    assert.equal(restarted.enqueueHistoricalRecovery("primary", "2026-09-16T00:00:00.000Z"), 0);
    inbox.ingest(connectorMessage('late-history','Pedido antigo recebido depois.', '2026-08-15T13:00:00.000Z'));
    assert.equal(restarted.enqueueHistoricalRecovery('primary','2026-09-17T00:00:00.000Z'),1);
    assert.equal(restarted.enqueueHistoricalRecovery('primary','2026-09-17T00:00:00.000Z'),0);
  } finally {
    await context.analyzer.shutdown();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('fila prioriza novos pedidos e permite retomar falhas com autorização', async () => {
  const context=setupAutomatic(false,'traffic');
  try {
    context.automatic.enqueueHistoricalRecovery('primary','2026-09-16T00:00:00.000Z');
    context.store.db.prepare("UPDATE whatsapp_analysis_batches SET created_at='2020-01-01',available_at='2099-01-01' WHERE chunk_index<0").run();
    await context.automatic.tick();
    assert.equal(context.store.db.prepare('SELECT COUNT(*) n FROM tasks').get()!.n,1);
    context.store.db.prepare("UPDATE whatsapp_analysis_batches SET status='failed',attempts=3 WHERE chunk_index<0").run();
    assert.throws(()=>context.automatic.retryFailed({id:'lucas',role:'employee'}),/FORBIDDEN/);
    assert.equal(context.automatic.retryFailed({id:'gestor',role:'admin'}).queued,1);
    const row=context.store.db.prepare('SELECT status,attempts,available_at FROM whatsapp_analysis_batches WHERE chunk_index<0').get()!;
    assert.equal(row.status,'pending');assert.equal(row.attempts,0);assert.equal(row.available_at,null);
  } finally {await context.analyzer.shutdown();context.store.close();rmSync(context.directory,{recursive:true,force:true});}
});

test("encaminhamento enviado pela equipe entra na análise mas protocolo e vazio não", async () => {
  const context = setupAutomatic(false, "traffic");
  try {
    const sync = new WhatsAppSyncState(context.store);
    const run = sync.start("primary", "2026-09-15T22:00:00.000Z");
    const inbox = new WhatsAppRawInbox(context.store);
    inbox.ingest({ ...connectorMessage("handoff-team", "A equipe de web vai trabalhar na página.", "2026-09-15T21:00:00.000Z"), direction: "outgoing" }, undefined, run.id);
    inbox.ingest({ ...connectorMessage("encrypted", "[secretEncryptedMessage]", "2026-09-15T21:01:00.000Z"), messageType: "secretEncryptedMessage" }, undefined, run.id);
    inbox.ingest({ ...connectorMessage("blank", "", "2026-09-15T21:02:00.000Z"), messageType: "unknown" }, undefined, run.id);
    sync.succeed(run.id, { imported: 3, duplicates: 0 });
    assert.equal(context.automatic.enqueueForSync(run.id), 1);
    const row = context.store.db.prepare("SELECT new_message_count FROM whatsapp_analysis_batches WHERE sync_run_id=?").get(run.id)!;
    assert.equal(row.new_message_count, 1);
    assert.equal(context.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE external_id IN ('encrypted','blank')").get()!.n, 0);
  } finally {
    await context.analyzer.shutdown();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("sincronização incremental analisa somente a mensagem nova e distribui caso seguro", async () => {
  const context = setupAutomatic(false, "traffic");
  try {
    assert.equal(context.automatic.enqueueForSync(context.syncRunId), 0);
    await context.automatic.tick();
    const task = context.store.db
      .prepare("SELECT id,kind,assignee_id FROM tasks WHERE project_id=?")
      .get(context.projectId);
    assert.equal(task!.kind, "traffic");
    assert.equal(task!.assignee_id, "thay");
    assert.equal(
      context.store.db
        .prepare(
          "SELECT status FROM whatsapp_analysis_batches WHERE project_id=?",
        )
        .get(context.projectId)!.status,
      "succeeded",
    );
    new WorkflowService(context.store).dispatch();
    assert.equal(
      context.store.db
        .prepare(
          "SELECT COUNT(*) count FROM notifications WHERE employee_id='thay'",
        )
        .get()!.count,
      1,
    );
  } finally {
    await context.analyzer.shutdown();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("caso incerto permanece na fila central até decisão da gestão", async () => {
  const context = setupAutomatic(true, "copy");
  try {
    await context.automatic.tick();
    context.store.db
      .prepare(
        "INSERT INTO participants(id,project_id,display_name,role,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        "team-member-sla",
        context.projectId,
        "Pessoa da equipe",
        "team",
        "2026-09-15T16:00:00.000Z",
      );
    context.store.db
      .prepare(
        "INSERT INTO messages(id,account_id,external_id,project_id,conversation_id,sender_id,direction,text,sent_at,received_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,'live')",
      )
      .run(
        "team-message-sla",
        "primary",
        "team-message-sla",
        context.projectId,
        "automatico@g.us",
        "team-member-sla",
        "incoming",
        "Mensagem interna anterior.",
        "2026-09-15T16:00:00.000Z",
        "2026-09-15T16:00:01.000Z",
      );
    const batch = context.store.db
      .prepare(
        "SELECT id,new_message_ids FROM whatsapp_analysis_batches WHERE project_id=?",
      )
      .get(context.projectId)!;
    context.store.db
      .prepare("UPDATE whatsapp_analysis_batches SET new_message_ids=? WHERE id=?")
      .run(
        JSON.stringify([
          "team-message-sla",
          ...(JSON.parse(String(batch.new_message_ids)) as string[]),
        ]),
        batch.id,
      );
    const queue = context.automatic.list({ id: "magda", role: "manager" });
    assert.equal(queue.proposals.length, 1);
    assert.equal(queue.counts.needs_review, 1);
    assert.equal(
      queue.proposals[0].client_message_first_sent_at,
      "2026-09-15T16:55:00.000Z",
    );
    assert.equal(
      queue.proposals[0].client_response_due_at,
      "2026-09-16T16:55:00.000Z",
    );
    assert.equal(queue.proposals[0].client_response_sla_hours, 24);
    assert.equal(queue.proposals[0].client_message_count, 1);
    const firstClientMessage = context.store.db
      .prepare("SELECT sender_id FROM messages WHERE external_id='new-1'")
      .get()!;
    context.store.db
      .prepare(
        "INSERT INTO messages(id,account_id,external_id,project_id,conversation_id,sender_id,direction,text,sent_at,received_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,'live')",
      )
      .run(
        "client-complement-sla",
        "primary",
        "client-complement-sla",
        context.projectId,
        "automatico@g.us",
        firstClientMessage.sender_id,
        "incoming",
        "Complemento sobre a mesma revisão da copy.",
        "2026-09-15T16:58:00.000Z",
        "2026-09-15T16:58:01.000Z",
      );
    const sourceProposal = context.store.db
      .prepare(
        "SELECT analysis_run_id FROM analysis_proposals WHERE id=?",
      )
      .get(queue.proposals[0].id)!;
    context.store.db
      .prepare(
        "INSERT INTO analysis_proposals(id,analysis_run_id,request_key,title,description,kind,priority,due_at,evidence_ids,needs_review) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "duplicate-proposal",
        sourceProposal.analysis_run_id,
        "orientar-revisao-copy",
        "Orientar revisão da copy",
        "Complemento da mesma entrega enviado em outra mensagem.",
        "service",
        "normal",
        null,
        JSON.stringify(["team-message-sla", "client-complement-sla"]),
        1,
      );
    assert.equal(
      context.automatic.consolidatePendingProposals(
        "2026-09-15T17:05:00.000Z",
      ),
      1,
    );
    const consolidated = context.automatic.list({
      id: "magda",
      role: "manager",
    });
    assert.equal(consolidated.proposals.length, 1);
    assert.match(consolidated.proposals[0].title, /orientar revisão/u);
    assert.equal(consolidated.proposals[0].evidenceIds.length, 3);
    assert.equal(consolidated.proposals[0].client_message_count, 2);
    assert.equal(
      consolidated.proposals[0].client_message_first_sent_at,
      "2026-09-15T16:55:00.000Z",
    );
    assert.equal(
      consolidated.proposals[0].client_message_last_sent_at,
      "2026-09-15T16:58:00.000Z",
    );
    assert.equal(
      context.store.db
        .prepare("SELECT status FROM analysis_proposals WHERE id=?")
        .get("duplicate-proposal")!.status,
      "rejected",
    );
    assert.equal(
      context.store.db.prepare("SELECT COUNT(*) count FROM tasks").get()!.count,
      0,
    );
    const proposalId = String(consolidated.proposals[0].id);
    const approved = context.analyzer.reviewProposal(
      { id: "magda", role: "manager" },
      proposalId,
      "approve",
    );
    assert.equal(approved.assigneeId, "magda");
    context.automatic.reconcileProposal(proposalId);
    assert.equal(
      context.store.db
        .prepare(
          "SELECT status FROM whatsapp_analysis_batches WHERE project_id=?",
        )
        .get(context.projectId)!.status,
      "succeeded",
    );
  } finally {
    await context.analyzer.shutdown();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});
