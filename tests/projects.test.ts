import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Store } from "../packages/database/store.ts";
import { ProjectService } from "../packages/core/project-service.ts";
import { WorkflowService } from "../packages/core/service.ts";
import { parseWhatsAppExport } from "../packages/whatsapp/import.ts";
import {
  bootstrapProductionAdmin,
  hashPassword,
} from "../apps/server/src/auth.ts";
import { createApp } from "../apps/server/src/server.ts";
import type { Actor } from "../packages/core/model.ts";

const exportText = readFileSync(
  new URL("../fixtures/whatsapp-export-ptbr.txt", import.meta.url),
  "utf8",
).replaceAll("Colaborador Visual", "Ana Demo");

test("parser reconhece exportação PT-BR, continuações e linhas de sistema", () => {
  const parsed = parseWhatsAppExport(exportText, "-03:00");
  assert.equal(parsed.messageCount, 3);
  assert.equal(parsed.skippedLines, 1);
  assert.deepEqual(
    parsed.participants.map((participant) => participant.name),
    ["Ana Demo", "Cliente"],
  );
  assert.match(parsed.messages[0].text, /atendimento personalizado/);
  assert.equal(parsed.messages[0].sentAt, "2026-09-14T13:00:00.000Z");
  assert.equal(parsed.contentHash.length, 64);
  assert.equal(
    parseWhatsAppExport(exportText.replaceAll("\n", "\r\n"), "-03:00")
      .contentHash,
    parsed.contentHash,
  );
  assert.throws(
    () =>
      parseWhatsAppExport(
        "31/02/2026, 25:00 - Cliente: Data inválida",
        "-03:00",
      ),
    /INVALID_EXPORT_DATE/,
  );
});

test("cadastro, briefing, importação e demanda manual preservam evidência e roteamento", () => {
  const store = new Store();
  const admin: Actor = { id: "admin", role: "admin" };
  const manager: Actor = { id: "gestor", role: "manager" };
  const projects = new ProjectService(store);
  const workflow = new WorkflowService(store);
  try {
    bootstrapProductionAdmin(store, {
      username: "admin",
      name: "Administrador",
      password: "senha-inicial-segura",
    });
    for (const [id, name, role] of [
      ["gestor", "Gestor", "manager"],
      ["magda", "Ana Demo", "employee"],
      ["fora", "Fora", "employee"],
    ])
      store.db
        .prepare(
          "INSERT INTO employees(id,name,role,password_hash) VALUES(?,?,?,?)",
        )
        .run(id, name, role, hashPassword("senha-segura-local"));
    store.db.prepare("INSERT INTO capabilities VALUES('magda','copy')").run();
    const clientId = projects.createClient(admin, "Cliente Exemplo");
    const projectId = projects.createProject(admin, {
      clientId,
      name: "Campanha principal",
      description: "Conversa exportada do grupo do cliente.",
      memberIds: ["gestor", "magda"],
      brief: {
        objective: "Organizar demandas da campanha",
        offer: "Atendimento personalizado",
        audience: "Leads da campanha",
        channel: "WhatsApp",
        restrictions: "Não prometer resultado garantido",
      },
    });
    assert.equal(projects.listClients(manager).length, 1);
    assert.equal(projects.listProjects(manager).length, 1);
    assert.throws(
      () => projects.getProject({ id: "fora", role: "employee" }, projectId),
      /FORBIDDEN/,
    );
    const preview = projects.previewImport(
      manager,
      projectId,
      exportText,
      "-03:00",
    );
    assert.equal(preview.messageCount, 3);
    const imported = projects.importConversation(manager, projectId, {
      filename: "Conversa do WhatsApp.txt",
      title: "Grupo da campanha",
      contents: exportText,
      utcOffset: "-03:00",
      teamNames: ["Ana Demo"],
    });
    assert.equal(imported.duplicate, false);
    assert.equal(imported.messageCount, 3);
    const duplicate = projects.importConversation(manager, projectId, {
      filename: "Conversa do WhatsApp.txt",
      title: "Grupo da campanha",
      contents: exportText,
      utcOffset: "-03:00",
      teamNames: ["Ana Demo"],
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM messages").get()!.count,
      3,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM jobs").get()!.count,
      0,
    );
    const messages = projects.listMessages(manager, projectId) as {
      id: string;
      sender_name: string;
      direction: string;
    }[];
    assert.equal(
      messages.find((message) => message.sender_name === "Ana Demo")!.direction,
      "outgoing",
    );
    const evidence = messages.find(
      (message) => message.sender_name === "Cliente",
    )!;
    const clientParticipant = store.db
      .prepare(
        "SELECT id FROM participants WHERE project_id=? AND display_name='Cliente'",
      )
      .get(projectId)!;
    projects.updateParticipantRole(
      manager,
      projectId,
      String(clientParticipant.id),
      "team",
    );
    assert.equal(
      store.db
        .prepare("SELECT role FROM participants WHERE id=?")
        .get(clientParticipant.id)!.role,
      "team",
    );
    assert.equal(
      store.db
        .prepare("SELECT direction FROM messages WHERE id=?")
        .get(evidence.id)!.direction,
      "outgoing",
    );
    const task = projects.createManualTask(manager, {
      projectId,
      title: "Revisar copy da campanha",
      description: "Revisar a copy destacando o atendimento personalizado.",
      kind: "copy",
      priority: "high",
      dueAt: null,
      assigneeId: null,
      evidenceIds: [evidence.id],
    });
    assert.equal(task.assigneeId, "magda");
    workflow.dispatch();
    assert.equal(
      store.db
        .prepare(
          "SELECT COUNT(*) count FROM notifications WHERE employee_id='magda'",
        )
        .get()!.count,
      1,
    );
    const version = projects.saveBrief(manager, projectId, {
      expectedRevision: 4,
      objective: "Acompanhar e concluir demandas",
      offer: "Atendimento personalizado",
      audience: "Leads da campanha",
      channel: "WhatsApp",
      restrictions: "Não prometer resultado garantido",
    });
    assert.equal(version, 2);
  } finally {
    store.close();
  }
});

test("HTTP: cliente, projeto, importação e demanda percorrem o fluxo completo", async () => {
  const store = new Store();
  bootstrapProductionAdmin(store, {
    username: "admin",
    name: "Administrador",
    password: "senha-inicial-segura",
  });
  for (const [id, name, role] of [
    ["gestor", "Gestor", "manager"],
    ["magda", "Ana Demo", "employee"],
  ])
    store.db
      .prepare(
        "INSERT INTO employees(id,name,role,password_hash) VALUES(?,?,?,?)",
      )
      .run(id, name, role, hashPassword("senha-segura-local"));
  store.db.prepare("INSERT INTO capabilities VALUES('magda','copy')").run();
  const { server } = createApp(store, { mode: "production" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token = "", data?: unknown) =>
    fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  try {
    const loginResponse = await request("/api/login", "", {
      username: "admin",
      password: "senha-inicial-segura",
    });
    assert.equal(loginResponse.status, 200);
    const admin = ((await loginResponse.json()) as { token: string }).token;
    const clientResponse = await request("/api/clients", admin, {
      name: "Cliente da API",
    });
    assert.equal(clientResponse.status, 201);
    const clientId = ((await clientResponse.json()) as { id: string }).id;
    const projectResponse = await request("/api/projects", admin, {
      clientId,
      name: "Projeto da API",
      description: "Fluxo completo pela API local.",
      memberIds: ["gestor", "magda"],
      brief: {
        objective: "Organizar as demandas",
        offer: "Atendimento personalizado",
        audience: "Clientes ativos",
        channel: "WhatsApp",
        restrictions: "Revisão humana obrigatória",
      },
    });
    assert.equal(projectResponse.status, 201);
    const projectId = ((await projectResponse.json()) as { id: string }).id;
    const preview = await request(
      `/api/projects/${projectId}/import-preview`,
      admin,
      { contents: exportText, utcOffset: "-03:00" },
    );
    assert.equal(preview.status, 200);
    assert.equal(
      ((await preview.json()) as { messageCount: number }).messageCount,
      3,
    );
    const imported = await request(
      `/api/projects/${projectId}/import-whatsapp`,
      admin,
      {
        filename: "Conversa API.txt",
        title: "Grupo da API",
        contents: exportText,
        utcOffset: "-03:00",
        teamNames: ["Ana Demo"],
      },
    );
    assert.equal(imported.status, 201);
    const messages = (await (
      await request(`/api/projects/${projectId}/messages`, admin)
    ).json()) as { id: string; sender_name: string }[];
    const evidenceId = messages.find(
      (message) => message.sender_name === "Cliente",
    )!.id;
    const taskResponse = await request("/api/tasks/manual", admin, {
      projectId,
      title: "Revisar copy",
      description: "Revisar a copy solicitada na conversa.",
      kind: "copy",
      priority: "high",
      dueAt: null,
      assigneeId: null,
      evidenceIds: [evidenceId],
    });
    assert.equal(taskResponse.status, 201);
    assert.equal(
      ((await taskResponse.json()) as { assigneeId: string }).assigneeId,
      "magda",
    );
    assert.equal(
      store.db
        .prepare(
          "SELECT COUNT(*) count FROM notifications WHERE employee_id='magda'",
        )
        .get()!.count,
      1,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
  }
});
