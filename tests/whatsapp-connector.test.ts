import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/database/store.ts";
import type {
  HistoricalMessageQuery,
  ReadOnlyWhatsAppConnector,
  WhatsAppConnectorMessage,
} from "../packages/whatsapp/connector.ts";
import { isWhatsAppConversationContent } from "../packages/whatsapp/connector.ts";
import { WhatsAppRuntime } from "../packages/whatsapp/runtime.ts";

const message: WhatsAppConnectorMessage = {
  accountId: "conta-teste",
  externalId: "mensagem-1",
  conversationId: "grupo-1",
  conversationTitle: "Grupo do cliente",
  isGroup: true,
  senderId: "cliente-1",
  direction: "incoming",
  text: "Precisamos revisar esta entrega.",
  sentAt: "2026-09-15T18:30:00.000Z",
  messageType: "chat",
  hasMedia: false,
};

test("eventos técnicos ficam fora da conversa e da análise", () => {
  assert.equal(isWhatsAppConversationContent("conversation"), true);
  assert.equal(isWhatsAppConversationContent("imageMessage"), true);
  assert.equal(isWhatsAppConversationContent("protocolMessage"), false);
  assert.equal(isWhatsAppConversationContent("reactionMessage"), false);
  assert.equal(isWhatsAppConversationContent("associatedChildMessage"), false);
  assert.equal(isWhatsAppConversationContent("unknown"), false);
  assert.equal(isWhatsAppConversationContent("secretEncryptedMessage"), false);
});

class FakeConnector implements ReadOnlyWhatsAppConnector {
  capabilities = {
    existingGroups: true,
    history: "partial" as const,
    outgoingHumanMessages: true,
    edits: true,
    deletions: true,
  };
  state = "disabled";
  query: HistoricalMessageQuery | null = null;
  subscriber: ((event: WhatsAppConnectorMessage) => Promise<void>) | null =
    null;
  messages: WhatsAppConnectorMessage[] = [message, message];
  async connect() {
    this.state = "connected";
  }
  async disconnect() {
    this.state = "disconnected";
  }
  subscribe(handler: (event: WhatsAppConnectorMessage) => Promise<void>) {
    this.subscriber = handler;
    return () => {
      this.subscriber = null;
    };
  }
  async *fetchMessages(query: HistoricalMessageQuery) {
    this.query = query;
    for (const item of this.messages) yield item;
  }
  status() {
    return { state: this.state, lastError: null } as {
      state: "disabled" | "connected" | "disconnected";
      lastError: null;
    };
  }
  pairing() {
    return { state: this.state, qrDataUrl: null } as {
      state: "disabled" | "connected" | "disconnected";
      qrDataUrl: null;
    };
  }
  async getCoverage() {
    return [];
  }
  async downloadAttachment(): Promise<{ bytes: Uint8Array; mime: string }> {
    throw new Error("ATTACHMENT_NOT_AVAILABLE");
  }
}

test('coleta parcial com falha é recuperada na próxima sincronização', async () => {
  const store=new Store();
  const connector=new FakeConnector();
  const runtime=new WhatsAppRuntime(store,connector,'conta-teste');
  const original=connector.fetchMessages.bind(connector);
  connector.fetchMessages=async function* (query) {
    for await (const item of original(query)) {yield item;throw new Error('NETWORK_FAILURE');}
  };
  try {
    await assert.rejects(runtime.start('2026-09-15T19:00:00.000Z'),/NETWORK_FAILURE/);
    connector.fetchMessages=original;
    await runtime.runSync('2026-09-15T19:01:00.000Z');
    const row=store.db.prepare('SELECT s.status FROM whatsapp_raw_messages r JOIN whatsapp_sync_runs s ON s.id=r.sync_run_id').get()!;
    assert.equal(row.status,'succeeded');
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM whatsapp_raw_messages').get()!.n,1);
  } finally {await runtime.stop();store.close();}
});

test("mensagem atrasada além da margem entra pela data de recebimento", async () => {
  const store = new Store();
  const connector = new FakeConnector();
  const runtime = new WhatsAppRuntime(store, connector, "conta-teste");
  try {
    await runtime.start("2026-09-15T19:00:00.000Z");
    await connector.subscriber!({ ...message, externalId: "late", sentAt: "2026-09-15T17:00:00.000Z" });
    store.db.prepare("UPDATE whatsapp_raw_messages SET received_at=? WHERE external_id='late'").run("2026-09-15T23:00:00.000Z");
    connector.messages = [];
    await runtime.runSync("2026-09-16T00:00:00.000Z");
    assert(store.db.prepare("SELECT sync_run_id FROM whatsapp_raw_messages WHERE external_id='late'").get()!.sync_run_id);
    assert.equal(runtime.status().importedLastRun, 1);
    await runtime.runSync("2026-09-16T05:00:00.000Z");
    assert.equal(runtime.status().importedLastRun, 0);
  } finally { await runtime.stop(); store.close(); }
});

test("runtime salva mensagens na caixa local e elimina repetições", async () => {
  const store = new Store();
  const connector = new FakeConnector();
  const runtime = new WhatsAppRuntime(store, connector, "conta-teste");
  try {
    await runtime.start("2026-09-15T19:00:00.000Z");
    assert.equal(connector.query!.from, "2026-08-15T19:00:00.000Z");
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM whatsapp_raw_chats").get()!
        .count,
      1,
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) count FROM whatsapp_raw_messages")
        .get()!.count,
      1,
    );
    assert.equal(runtime.status().importedLastRun, 1);
    assert.equal(runtime.status().duplicatesLastRun, 1);
    assert.equal(runtime.status().chatCount, 1);
    assert.equal(runtime.status().messageCount, 1);
  } finally {
    await runtime.stop();
    store.close();
  }
});

test("evento ao vivo é persistido e entra na sincronização incremental seguinte", async () => {
  const store = new Store();
  const connector = new FakeConnector();
  const runtime = new WhatsAppRuntime(store, connector, "conta-teste");
  const liveMessage: WhatsAppConnectorMessage = {
    ...message,
    externalId: "mensagem-ao-vivo",
    text: "Nova solicitação recebida enquanto o leitor estava conectado.",
    sentAt: "2026-09-15T23:50:00.000Z",
  };
  try {
    await runtime.start("2026-09-15T19:00:00.000Z");
    await connector.subscriber!(liveMessage);
    assert.equal(
      store.db
        .prepare(
          "SELECT sync_run_id FROM whatsapp_raw_messages WHERE external_id=?",
        )
        .get(liveMessage.externalId)!.sync_run_id,
      null,
    );
    connector.messages = [liveMessage];
    await runtime.runSync("2026-09-16T00:00:00.000Z");
    const latest = store.db
      .prepare(
        "SELECT id,mode,imported_count,duplicate_count FROM whatsapp_sync_runs ORDER BY started_at DESC LIMIT 1",
      )
      .get()!;
    assert.equal(latest.mode, "incremental");
    assert.equal(latest.imported_count, 1);
    assert.equal(latest.duplicate_count, 0);
    assert.equal(
      store.db
        .prepare(
          "SELECT sync_run_id FROM whatsapp_raw_messages WHERE external_id=?",
        )
        .get(liveMessage.externalId)!.sync_run_id,
      latest.id,
    );
  } finally {
    await runtime.stop();
    store.close();
  }
});

test("reinício antes do horário preserva checkpoint sem nova coleta", async () => {
  const store = new Store();
  const firstConnector = new FakeConnector();
  const first = new WhatsAppRuntime(store, firstConnector, "conta-teste");
  try {
    await first.start("2026-09-15T19:00:00.000Z");
    await first.stop();
    const secondConnector = new FakeConnector();
    const second = new WhatsAppRuntime(store, secondConnector, "conta-teste");
    await second.start("2026-09-15T19:30:00.000Z");
    assert.equal(secondConnector.query, null);
    assert.equal(second.status().nextSyncAt, "2026-09-16T00:00:00.000Z");
    await second.stop();
  } finally {
    store.close();
  }
});
