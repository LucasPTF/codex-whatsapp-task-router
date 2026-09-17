import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../../../packages/database/store.ts";
import { createApp } from "./server.ts";
import { bootstrapProductionAdmin, seedDemo } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { BaileysReadOnlyConnector } from "../../../packages/whatsapp/baileys-connector.ts";
import { WhatsAppRuntime } from "../../../packages/whatsapp/runtime.ts";
import type { WhatsAppCompletedSync } from "../../../packages/whatsapp/runtime.ts";
import { WhatsAppOnboarding } from "../../../packages/whatsapp/onboarding.ts";
import { WhatsAppConversationArchive } from "../../../packages/whatsapp/conversation-archive.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = new Store(config.databasePath);
if (config.mode === "demo") seedDemo(store);
else {
  const created = bootstrapProductionAdmin(store, {
    username: process.env.BOOTSTRAP_ADMIN_USERNAME,
    name: process.env.BOOTSTRAP_ADMIN_NAME,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  });
  if (created)
    console.log(
      "Administrador inicial criado. Remova as variáveis BOOTSTRAP_ADMIN_* do ambiente.",
    );
  delete process.env.BOOTSTRAP_ADMIN_USERNAME;
  delete process.env.BOOTSTRAP_ADMIN_NAME;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
}
const whatsappOnboarding = new WhatsAppOnboarding(
  store,
  config.whatsapp.accountId,
  config.mode === "demo",
);
const registerEligibleGroups = () => {
  try {
    const result = whatsappOnboarding.autoMapEligibleGroups();
    if (result.mapped || result.failed)
      console.log(
        `whatsapp_auto_clients mapped=${result.mapped} failed=${result.failed} pending=${result.skipped}`,
      );
  } catch (error) {
    console.error(
      "whatsapp_auto_clients_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
};
if (config.whatsapp.enabled) registerEligibleGroups();
const conversationArchive = new WhatsAppConversationArchive(
  store,
  resolve(config.dataDir, "conversas-clientes"),
);
if (config.whatsapp.enabled) {
  const archived = conversationArchive.refreshAll();
  console.log(`whatsapp_conversation_archive refreshed=${archived}`);
}
let whatsappRuntime: WhatsAppRuntime | null = null;
const { server, tick, analyzer, automaticAnalysis } = createApp(store, {
  mode: config.mode,
  analyzer: config.analyzer,
  whatsappStatus: () =>
    whatsappRuntime?.status() ?? { state: "disabled", lastError: null },
  whatsappPairing: () =>
    whatsappRuntime?.pairing() ?? { state: "disabled", qrDataUrl: null },
  whatsappSync: async () => {
    if (!whatsappRuntime) throw new Error("WHATSAPP_DISABLED");
    await whatsappRuntime.runSync();
  },
  whatsappAccountId: config.whatsapp.accountId,
});
const afterSuccessfulSync = (sync: WhatsAppCompletedSync) => {
  registerEligibleGroups();
  conversationArchive.refreshForSync(sync.runId);
  const queued = automaticAnalysis.enqueueForSync(sync.runId);
  automaticAnalysis.enqueueHistoricalRecovery(sync.accountId);
  if (queued)
    console.log(
      `automatic_analysis queued=${queued} sync=${sync.runId} imported=${sync.imported}`,
    );
  void automaticAnalysis
    .tick()
    .catch((error) =>
      console.error(
        "automatic_analysis_failed",
        error instanceof Error ? error.message : "unknown",
      ),
    );
};
whatsappRuntime = config.whatsapp.enabled
  ? new WhatsAppRuntime(
      store,
      new BaileysReadOnlyConnector({
        accountId: config.whatsapp.accountId,
        authPath: config.whatsapp.authPath,
      }),
      config.whatsapp.accountId,
      afterSuccessfulSync,
    )
  : null;
if (config.whatsapp.enabled && config.analyzer.enabled)
  automaticAnalysis.enqueueHistoricalRecovery(config.whatsapp.accountId);
server.listen(config.port, "127.0.0.1", () => {
  if (config.mode === "demo")
    console.log(
      `DEMONSTRAÇÃO LOCAL: http://127.0.0.1:${config.port} | perfis fictícios gestor, conteúdo, revisão, web e mídia | senha demo-local-2026 | Codex ${analyzer.status().state} | WhatsApp ${whatsappRuntime ? "habilitado" : "desativado"}`,
    );
  else
    console.log(
      `PRODUÇÃO LOCAL: http://127.0.0.1:${config.port} | sem seed/fixture | rede compartilhada ainda desativada`,
    );
  if (whatsappRuntime)
    void whatsappRuntime
      .start()
      .catch((error) =>
        console.error(
          "whatsapp_start_failed",
          error instanceof Error ? error.message : "unknown",
        ),
      );
});
const timer = setInterval(() => {
  try {
    tick();
    if (whatsappRuntime)
      void whatsappRuntime
        .tick()
        .catch(() => console.error("whatsapp_sync_failed"));
  } catch {
    console.error("scheduler_failed");
  }
}, 60000);
timer.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await analyzer.shutdown();
  if (whatsappRuntime) await whatsappRuntime.stop();
  await new Promise<void>((done) => server.close(() => done()));
  store.close();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
