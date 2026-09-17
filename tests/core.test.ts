import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/database/store.ts";
import { Queue } from "../packages/database/queue.ts";
import { WorkflowService } from "../packages/core/service.ts";
import { parseAnalysis } from "../packages/contracts/validate.ts";
import { seedDemo } from "../apps/server/src/auth.ts";
import type { Analysis, Actor, MessageInput } from "../packages/core/model.ts";
const now = "2026-09-14T12:00:00.000Z";
const manager: Actor = { id: "gestor", role: "manager" },
  magda: Actor = { id: "magda", role: "employee" };
function setup(path = ":memory:") {
  const store = new Store(path);
  seedDemo(store);
  return { store, svc: new WorkflowService(store) };
}
function message(id = "m1", source: "live" | "import" = "live"): MessageInput {
  return {
    id,
    externalId: id,
    accountId: "a",
    conversationId: "c",
    projectId: "demo-campanha",
    senderId: "client",
    direction: "incoming",
    text: "Preciso alterar a copy.",
    sentAt: now,
    source,
  };
}
function analysis(revision = 1): Analysis {
  return {
    projectId: "demo-campanha",
    projectRevision: revision,
    summary: "Pedido de revisão",
    proposals: [
      {
        requestKey: "copy-01",
        title: "Revisar copy",
        description: "Revisar oferta com evidência",
        kind: "copy",
        priority: "normal",
        dueAt: null,
        evidenceIds: ["m1"],
        needsReview: false,
      },
    ],
  };
}
test("perfis demonstrativos têm acesso e especialidades de roteamento definidas", () => {
  const { store, svc } = setup();
  try {
    assert.deepEqual(
      store.db
        .prepare("SELECT id,role FROM employees ORDER BY id")
        .all()
        .map((row) => [row.id, row.role]),
      [
        ["gestor", "admin"],
        ["lucas", "employee"],
        ["magda", "manager"],
        ["sabrina", "manager"],
        ["thay", "employee"],
      ],
    );
    assert.deepEqual(
      store.db
        .prepare(
          "SELECT kind FROM capabilities WHERE employee_id='sabrina' ORDER BY kind",
        )
        .all()
        .map((row) => row.kind),
      ["copy", "design", "service", "strategy"],
    );
    assert.equal(
      store.db
        .prepare("SELECT auto_assign FROM employees WHERE id='sabrina'")
        .get()!.auto_assign,
      0,
      "O perfil revisor tem as mesmas capacidades do perfil de conteúdo, mas não duplica a distribuição automática",
    );
    for (const id of ["m-page", "m-design", "m-traffic", "m-strategy"])
      svc.ingest(message(id), now);
    const routed = parseAnalysis({
      projectId: "demo-campanha",
      projectRevision: 4,
      summary: "Quatro demandas separadas por especialidade.",
      messageDecisions: [],
      proposals: [
        {
          requestKey: "site-01",
          operation: 'upsert', expectedTaskVersion: null,
          title: "Alterar site",
          description: "Atualizar uma seção do site.",
          kind: "page",
          priority: "normal",
          dueAt: null,
          evidenceIds: ["m-page"],
          needsReview: false,
        },
        {
          requestKey: "creative-01",
          operation: 'upsert', expectedTaskVersion: null,
          title: "Criar peça estática",
          description: "Produzir um criativo estático para a campanha.",
          kind: "design",
          priority: "normal",
          dueAt: null,
          evidenceIds: ["m-design"],
          needsReview: false,
        },
        {
          requestKey: "traffic-01",
          operation: 'upsert', expectedTaskVersion: null,
          title: "Configurar pixel",
          description: "Revisar o pixel da campanha.",
          kind: "traffic",
          priority: "high",
          dueAt: null,
          evidenceIds: ["m-traffic"],
          needsReview: false,
        },
        {
          requestKey: "funnel-01",
          operation: 'upsert', expectedTaskVersion: null,
          title: "Revisar funil",
          description: "Revisar a estrutura do funil.",
          kind: "strategy",
          priority: "normal",
          dueAt: null,
          evidenceIds: ["m-strategy"],
          needsReview: false,
        },
      ],
    });
    svc.applyAnalysis(routed, now);
    const assignments = Object.fromEntries(
      store.db
        .prepare("SELECT kind,assignee_id FROM tasks")
        .all()
        .map((row) => [row.kind, row.assignee_id]),
    );
    assert.deepEqual(assignments, {
      design: "magda",
      page: "lucas",
      traffic: "thay",
      strategy: "magda",
    });
  } finally {
    store.close();
  }
});
test("ingestão idempotente cria uma mensagem e um job", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    assert.equal(svc.ingest(message(), now).duplicate, true);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM jobs").get()!.n, 1);
  } finally {
    store.close();
  }
});
test("histórico importado não dispara análise", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message("m1", "import"), now);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM jobs").get()!.n, 0);
  } finally {
    store.close();
  }
});
test("conteúdo divergente com mesmo ID exige revisão explícita", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    assert.throws(
      () => svc.ingest({ ...message(), text: "Outro texto" }, now),
      /MESSAGE_REQUIRES_REVISION/,
    );
  } finally {
    store.close();
  }
});
test("análise velha não cria tarefas", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    svc.ingest(message("m2"), now);
    assert.throws(() => svc.applyAnalysis(analysis(), now), /STALE_ANALYSIS/);
    assert.equal(svc.list(manager).length, 0);
  } finally {
    store.close();
  }
});
test("evidência estrangeira reverte toda a transação", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    const a = analysis();
    a.proposals.push({
      ...a.proposals[0],
      requestKey: "other",
      evidenceIds: ["unknown"],
    });
    assert.throws(() => svc.applyAnalysis(a, now), /FOREIGN_EVIDENCE/);
    assert.equal(svc.list(manager).length, 0);
  } finally {
    store.close();
  }
});
test("duas análises da mesma intenção não duplicam tarefa", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    svc.applyAnalysis(analysis(), now);
    svc.applyAnalysis(analysis(), now);
    assert.equal(svc.list(manager).length, 1);
    assert.equal(svc.list(magda)[0].assignee_id, "magda");
  } finally {
    store.close();
  }
});
test("ambiguidade de responsável encaminha à triagem", () => {
  const { store, svc } = setup();
  try {
    store.db.prepare("INSERT INTO capabilities VALUES('lucas','copy')").run();
    svc.ingest(message(), now);
    svc.applyAnalysis(analysis(), now);
    assert.equal(svc.list(manager)[0].assignee_id, null);
    svc.dispatch(now);
    assert.equal(
      store.db
        .prepare(
          "SELECT COUNT(*) n FROM notifications WHERE employee_id='gestor'",
        )
        .get()!.n,
      1,
    );
  } finally {
    store.close();
  }
});
test("notificação visualizada não assume tarefa e dispatch não duplica", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    svc.applyAnalysis(analysis(), now);
    svc.dispatch(now);
    svc.dispatch(now);
    store.db.prepare("UPDATE notifications SET read_at=?").run(now);
    assert.equal(svc.list(magda)[0].status, "open");
    assert.equal(
      store.db.prepare("SELECT COUNT(*) n FROM notifications").get()!.n,
      1,
    );
  } finally {
    store.close();
  }
});
test("funcionário não altera tarefa de colega", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    const [id] = svc.applyAnalysis(analysis(), now);
    assert.throws(
      () =>
        svc.transition(
          { id: "lucas", role: "employee" },
          id,
          1,
          "in_progress",
          "",
          now,
        ),
      /FORBIDDEN/,
    );
  } finally {
    store.close();
  }
});
test("conflito de versão bloqueia segunda alteração e conclusão exige resultado", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    const [id] = svc.applyAnalysis(analysis(), now);
    svc.transition(magda, id, 1, "in_progress", "", now);
    assert.throws(
      () => svc.transition(magda, id, 1, "blocked", "Motivo", now),
      /VERSION_CONFLICT/,
    );
    assert.throws(
      () => svc.transition(magda, id, 2, "done", "", now),
      /REASON_REQUIRED/,
    );
    svc.transition(magda, id, 2, "done", "Copy revisada e salva.", now);
    assert.equal(svc.list(magda)[0].status, "done");
  } finally {
    store.close();
  }
});
test("escalonamento inclui gestor e é idempotente", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    svc.applyAnalysis(analysis(), now);
    svc.escalate("2026-09-14T13:00:00.000Z");
    svc.escalate("2026-09-14T13:00:00.000Z");
    assert.deepEqual(
      store.db
        .prepare("SELECT employee_id FROM notifications ORDER BY employee_id")
        .all()
        .map((row) => row.employee_id),
      ["gestor", "magda", "sabrina"],
    );
  } finally {
    store.close();
  }
});
test("outbox sobrevive ao reinício", () => {
  const dir = mkdtempSync(join(tmpdir(), "controle-"));
  const path = join(dir, "db.sqlite");
  try {
    const first = setup(path);
    first.svc.ingest(message(), now);
    first.svc.applyAnalysis(analysis(), now);
    first.store.close();
    const second = setup(path);
    try {
      second.svc.dispatch(now);
      assert.equal(
        second.store.db.prepare("SELECT COUNT(*) n FROM notifications").get()!
          .n,
        1,
      );
    } finally {
      second.store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("job expirado recebe novo token; executor antigo não conclui", () => {
  const { store, svc } = setup();
  try {
    svc.ingest(message(), now);
    const q = new Queue(store),
      first = q.claim(now, 1000)!;
    const second = q.claim("2026-09-14T12:00:02.000Z", 10000)!;
    assert.notEqual(first.lease_token, second.lease_token);
    assert.equal(
      q.finish(
        String(first.id),
        String(first.lease_token),
        "2026-09-14T12:00:03.000Z",
      ),
      false,
    );
    assert.equal(
      q.finish(
        String(second.id),
        String(second.lease_token),
        "2026-09-14T12:00:03.000Z",
      ),
      true,
    );
  } finally {
    store.close();
  }
});
test("schema rejeita operação externa não prevista", () => {
  assert.throws(
    () => parseAnalysis({ ...analysis(), sendMessage: "cliente" }),
    /INVALID_ANALYSIS_SCHEMA/,
  );
});
test("audit é append-only pela conexão da aplicação", () => {
  const { store, svc } = setup();
  try {
    svc.audit("gestor", "test", "x", {}, now);
    assert.throws(() => store.db.exec("DELETE FROM audit_logs"), /append-only/);
  } finally {
    store.close();
  }
});
