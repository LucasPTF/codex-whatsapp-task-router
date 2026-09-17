import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDemo } from "../apps/server/src/auth.ts";
import { Store } from "../packages/database/store.ts";
import type { WhatsAppConnectorMessage } from "../packages/whatsapp/connector.ts";
import {
  classifyClientGroupTitle,
  WhatsAppOnboarding,
} from "../packages/whatsapp/onboarding.ts";
import { WhatsAppRawInbox } from "../packages/whatsapp/raw-inbox.ts";
import { WhatsAppConversationArchive } from "../packages/whatsapp/conversation-archive.ts";

function message(
  externalId: string,
  conversationId: string,
  conversationTitle: string,
  isGroup: boolean,
): WhatsAppConnectorMessage {
  return {
    accountId: "primary",
    externalId,
    conversationId,
    conversationTitle,
    isGroup,
    senderId: "cliente@lid",
    direction: "incoming",
    text: "Precisamos de uma revisão.",
    sentAt: "2026-09-15T18:00:00.000Z",
    messageType: "conversation",
    hasMedia: false,
  };
}

test("cadastro por grupo preserva numeração e conecta mensagens futuras", () => {
  const store = new Store();
  seedDemo(store);
  const inbox = new WhatsAppRawInbox(store);
  const onboarding = new WhatsAppOnboarding(store, "primary", true);
  const exactTitle = "0017 - Cliente Árvore";
  try {
    inbox.ingest(message("m-1", "grupo@g.us", exactTitle, true));
    inbox.ingest(
      message("p-1", "pessoa@s.whatsapp.net", "Conversa pessoal", false),
    );
    const groups = onboarding.listGroups({ id: "gestor", role: "manager" });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, exactTitle);
    const mapped = onboarding.mapGroup(
      { id: "gestor", role: "manager" },
      "grupo@g.us",
      [],
      "2026-09-15T19:00:00.000Z",
    );
    assert.equal(mapped.title, exactTitle);
    assert.equal(mapped.messageCount, 1);
    assert.equal(
      store.db
        .prepare("SELECT name FROM clients WHERE id=?")
        .get(mapped.clientId)!.name,
      exactTitle,
    );
    assert.equal(
      store.db
        .prepare("SELECT name FROM projects WHERE id=?")
        .get(mapped.projectId)!.name,
      exactTitle,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM messages").get()!.count,
      1,
    );
    inbox.ingest({
      ...message("m-2", "grupo@g.us", exactTitle, true),
      sentAt: "2026-09-15T19:05:00.000Z",
    });
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM messages").get()!.count,
      2,
    );
    assert.equal(
      onboarding.mapGroup({ id: "gestor", role: "manager" }, "grupo@g.us", [])
        .duplicate,
      true,
    );
  } finally {
    store.close();
  }
});

test("dois grupos com o mesmo nome compartilham cliente e projeto", () => {
  const store = new Store();
  seedDemo(store);
  const inbox = new WhatsAppRawInbox(store);
  const onboarding = new WhatsAppOnboarding(store, "primary", true);
  const exactTitle = "231) Cliente Repetido L.2 [T JUN] [20%]";
  try {
    inbox.ingest({
      ...message("grupo-a-1", "grupo-a@g.us", exactTitle, true),
      senderId: "grupo-a@g.us",
    });
    inbox.ingest({
      ...message("grupo-b-1", "grupo-b@g.us", exactTitle, true),
      senderId: "grupo-b@g.us",
    });

    const first = onboarding.mapGroup(
      { id: "gestor", role: "manager" },
      "grupo-a@g.us",
      [],
    );
    const second = onboarding.mapGroup(
      { id: "gestor", role: "manager" },
      "grupo-b@g.us",
      [],
    );

    assert.equal(second.clientId, first.clientId);
    assert.equal(second.projectId, first.projectId);
    assert.equal(second.createdClient, false);
    assert.equal(second.createdProject, false);
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM projects WHERE client_id=?")
        .get(first.clientId)!.count,
      1,
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM conversations WHERE project_id=?")
        .get(first.projectId)!.count,
      2,
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM messages WHERE project_id=?")
        .get(first.projectId)!.count,
      2,
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM participants WHERE project_id=?")
        .get(first.projectId)!.count,
      2,
    );

    onboarding.ignoreGroup({ id: "gestor", role: "manager" }, "grupo-b@g.us");
    assert.equal(
      store.db
        .prepare("SELECT active FROM projects WHERE id=?")
        .get(first.projectId)!.active,
      1,
      "bloquear um dos grupos não pode ocultar o outro grupo do mesmo cliente",
    );
  } finally {
    store.close();
  }
});

test("arquivo por cliente materializa conversa legível e JSONL", () => {
  const store = new Store();
  const directory = mkdtempSync(join(tmpdir(), "controle-conversas-"));
  seedDemo(store);
  const inbox = new WhatsAppRawInbox(store);
  const onboarding = new WhatsAppOnboarding(store, "primary", true);
  try {
    inbox.ingest(
      message(
        "arquivo-1",
        "arquivo@g.us",
        "317) Cliente Arquivo [T SET] [20%]",
        true,
      ),
    );
    onboarding.mapGroup({ id: "gestor", role: "manager" }, "arquivo@g.us", []);
    inbox.ingest({
      ...message("arquivo-2", "arquivo@g.us", "arquivo@g.us", true),
      sentAt: "2026-09-15T18:05:00.000Z",
    });
    assert.equal(
      store.db
        .prepare(
          "SELECT title FROM whatsapp_raw_chats WHERE conversation_id='arquivo@g.us'",
        )
        .get()!.title,
      "317) Cliente Arquivo [T SET] [20%]",
    );
    const archive = new WhatsAppConversationArchive(store, directory);
    assert.equal(archive.refreshAll(), 1);
    const folders = readdirSync(directory);
    assert.equal(folders.length, 1);
    assert.match(folders[0], /^317\) Cliente Arquivo/);
    const info = JSON.parse(
      readFileSync(join(directory, folders[0], "informacoes.json"), "utf8"),
    );
    assert.equal(info.messageCount, 2);
    assert.match(
      readFileSync(join(directory, folders[0], "conversa.txt"), "utf8"),
      /Precisamos de uma revisão/,
    );
    const jsonl = readFileSync(
      join(directory, folders[0], "mensagens.jsonl"),
      "utf8",
    );
    assert.deepEqual(
      jsonl
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).externalId),
      ["arquivo-1", "arquivo-2"],
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("grupo sem autor não vira participante e remetente técnico recebe nome legível", () => {
  const store = new Store();
  seedDemo(store);
  const inbox = new WhatsAppRawInbox(store);
  const onboarding = new WhatsAppOnboarding(store, "primary", true);
  const groupId = "demo-group@g.us";
  const exactTitle = "118) Cliente Exemplo. L24-28 [T JAN] [20%]";
  try {
    inbox.ingest({
      ...message("incoming-1", groupId, exactTitle, true),
      senderId: groupId,
    });
    inbox.ingest({
      ...message("outgoing-1", groupId, exactTitle, true),
      senderId: "12025550199:7@s.whatsapp.net",
      direction: "outgoing",
      sentAt: "2026-09-15T18:05:00.000Z",
    });
    const mapped = onboarding.mapGroup(
      { id: "gestor", role: "manager" },
      groupId,
      [],
      "2026-09-15T19:00:00.000Z",
    );
    assert.deepEqual(
      store.db
        .prepare(
          "SELECT display_name,role,external_sender_id FROM participants WHERE project_id=? ORDER BY display_name",
        )
        .all(mapped.projectId)
        .map((row) => ({
          display_name: row.display_name,
          role: row.role,
          external_sender_id: row.external_sender_id,
        })),
      [
        {
          display_name: "Cliente não identificado",
          role: "unknown",
          external_sender_id:
            "unknown-group-participant:demo-group@g.us",
        },
        {
          display_name: "Equipe (WhatsApp conectado)",
          role: "team",
          external_sender_id: "12025550199:7@s.whatsapp.net",
        },
      ],
    );
    assert.equal(
      store.db
        .prepare(
          "SELECT COUNT(*) count FROM participants WHERE project_id=? AND display_name LIKE '%@g.us'",
        )
        .get(mapped.projectId)!.count,
      0,
    );

    inbox.ingest({
      ...message("incoming-2", groupId, exactTitle, true),
      senderId: groupId,
      sentAt: "2026-09-15T19:05:00.000Z",
    });
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM participants WHERE project_id=?")
        .get(mapped.projectId)!.count,
      2,
      "mensagem futura sem autor deve reutilizar o participante desconhecido",
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM messages WHERE project_id=?")
        .get(mapped.projectId)!.count,
      3,
      "a correção de identidade não pode descartar mensagens",
    );
  } finally {
    store.close();
  }
});

test("diretório identifica equipe por telefone ou nome sem confundir com cliente", () => {
  const store = new Store();
  seedDemo(store);
  const inbox = new WhatsAppRawInbox(store);
  const onboarding = new WhatsAppOnboarding(store, "primary", true);
  const groupId = "equipe-identificada@g.us";
  const exactTitle = "119) Cliente teste [T JAN] [20%]";
  try {
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM whatsapp_team_identities")
        .get()!.count,
      12,
    );
    inbox.ingest({
      ...message("conteudo-1", groupId, exactTitle, true),
      senderId: "12025550101@s.whatsapp.net",
      senderName: "~Ana Demo",
    });
    const mapped = onboarding.mapGroup(
      { id: "gestor", role: "manager" },
      groupId,
      [],
      "2026-09-15T19:00:00.000Z",
    );
    inbox.ingest({
      ...message("estudio-1", groupId, exactTitle, true),
      senderId: "987654321@lid",
      senderName: "Estúdio Exemplo",
      sentAt: "2026-09-15T19:05:00.000Z",
    });
    inbox.ingest({
      ...message("cliente-1", groupId, exactTitle, true),
      senderId: "12025550199@s.whatsapp.net",
      senderName: "Cliente Externo",
      sentAt: "2026-09-15T19:10:00.000Z",
    });
    assert.deepEqual(
      store.db
        .prepare(
          "SELECT display_name,role FROM participants WHERE project_id=? ORDER BY display_name",
        )
        .all(mapped.projectId)
        .map((row) => [row.display_name, row.role]),
      [
        ["12025550199@s.whatsapp.net", "client"],
        ["Ana · Conteúdo", "team"],
        ["Estúdio Exemplo · Conteúdo", "team"],
      ],
    );
  } finally {
    store.close();
  }
});

test("gestão enumera grupos e funcionário operacional não", () => {
  const store = new Store();
  seedDemo(store);
  try {
    const onboarding = new WhatsAppOnboarding(store, "primary", false);
    assert.deepEqual(
      onboarding.listGroups({ id: "magda", role: "manager" }),
      [],
    );
    assert.throws(
      () => onboarding.listGroups({ id: "lucas", role: "employee" }),
      /FORBIDDEN/,
    );
  } finally {
    store.close();
  }
});

test("classificador reconhece a nomenclatura real e usa o mês como indicativo", () => {
  for (const title of [
    "[TM] Hosana [T SET] [EXEC.1]",
    "253) Ana Cláudia L.2 [T JUL] [20%]",
    "303) Monica L.2 [T AGO][20%]",
    "227) Lisandra e Salete [L.2] [T JUN] [20%]",
    "186) Walter Cincinatto. L2- 3K [ABR] [20%]",
    "Jonathan Amâncio L.2 [T AGO][20%]",
    "Cliente sem numeração [ABR]",
    "Evanir L.2 (T OUT) [25]",
    "Silvana Rosa L.2 TJULHO",
    "Cliente Alfa L.2 Setembro",
    "Cliente Beta L.2 ( pagamento dia 17.08)",
    "Cliente Gama T196 ( aguardando Pgt)",
  ])
    assert.equal(
      classifyClientGroupTitle(title).eligible,
      true,
      `deveria reconhecer ${title}`,
    );
  for (const title of [
    "Equipe interna",
    "Equipe interna Setembro",
    "Financeiro [20%]",
    "Reunião [EXEC.1]",
  ])
    assert.equal(
      classifyClientGroupTitle(title).eligible,
      false,
      `não deveria reconhecer ${title}`,
    );
});

test("cadastro automático preserva o título e ignorar falso positivo interrompe o espelho", () => {
  const store = new Store();
  seedDemo(store);
  const inbox = new WhatsAppRawInbox(store);
  const onboarding = new WhatsAppOnboarding(store, "primary", true);
    const exactTitle = "Cliente da Campanha [T JUL]";
  try {
    inbox.ingest(message("auto-1", "automatico@g.us", exactTitle, true));
    inbox.ingest(message("interno-1", "interno@g.us", "Equipe interna", true));
    const result = onboarding.autoMapEligibleGroups("2026-09-15T19:00:00.000Z");
    assert.equal(result.mapped, 1);
    assert.equal(result.skipped, 1);
    assert.equal(onboarding.listGroups({id:'gestor', role:'manager'}).some((item) => item.conversationId==='automatico@g.us'), false);
    assert.throws(() => onboarding.ignoreGroup({id:'gestor', role:'manager'}, 'automatico@g.us'), /FORBIDDEN/);
    store.db.prepare('INSERT INTO project_members(project_id,employee_id) SELECT project_id,? FROM whatsapp_raw_chats WHERE conversation_id=?').run('gestor','automatico@g.us');
    const group = onboarding
      .listGroups({ id: "gestor", role: "manager" })
      .find((item) => item.conversationId === "automatico@g.us")!;
    assert.equal(group.title, exactTitle);
    assert.equal(group.mappingState, "mapped");
    assert.equal(group.mappingMethod, "automatic");
    assert.equal(
      store.db
        .prepare("SELECT name FROM projects WHERE id=?")
        .get(group.projectId)!.name,
      exactTitle,
    );

    onboarding.ignoreGroup(
      { id: "gestor", role: "manager" },
      "automatico@g.us",
      "2026-09-15T20:00:00.000Z",
    );
    assert.equal(
      store.db
        .prepare("SELECT active FROM projects WHERE id=?")
        .get(group.projectId)!.active,
      0,
    );
    inbox.ingest({
      ...message("auto-2", "automatico@g.us", exactTitle, true),
      sentAt: "2026-09-15T20:05:00.000Z",
    });
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM messages").get()!.count,
      1,
    );
    assert.equal(
      onboarding.autoMapEligibleGroups().mapped,
      0,
      "grupo ignorado não deve reaparecer",
    );
    const restored = onboarding.restoreGroup(
      { id: "gestor", role: "manager" },
      "automatico@g.us",
      "2026-09-15T21:00:00.000Z",
    );
    assert.equal(restored.mappingState, "mapped");
    assert.equal(restored.importedMessages, 1);
    assert.equal(
      store.db
        .prepare("SELECT active FROM projects WHERE id=?")
        .get(group.projectId)!.active,
      1,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM messages").get()!.count,
      2,
      "restauração deve recuperar mensagem recebida durante o bloqueio",
    );
    inbox.ingest({
      ...message("auto-3", "automatico@g.us", exactTitle, true),
      sentAt: "2026-09-15T21:05:00.000Z",
    });
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM messages").get()!.count,
      3,
    );

    onboarding.ignoreGroup({ id: "gestor", role: "manager" }, "interno@g.us");
    assert.equal(
      onboarding
        .listGroups({ id: "gestor", role: "manager" })
        .find((item) => item.conversationId === "interno@g.us")!.mappingState,
      "ignored",
    );
    const pendingRestore = onboarding.restoreGroup(
      { id: "gestor", role: "manager" },
      "interno@g.us",
    );
    assert.equal(pendingRestore.mappingState, "pending");
  } finally {
    store.close();
  }
});
