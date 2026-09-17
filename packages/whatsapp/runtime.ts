import type { Store } from "../database/store.ts";
import type {
  ReadOnlyWhatsAppConnector,
  WhatsAppPairingStatus,
  WhatsAppConnectorStatus,
} from "./connector.ts";
import { WhatsAppRawInbox } from "./raw-inbox.ts";
import { WhatsAppSyncState, WHATSAPP_SYNC_INTERVAL_MS } from "./sync.ts";

export type WhatsAppRuntimeStatus = WhatsAppConnectorStatus & {
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  importedLastRun: number;
  duplicatesLastRun: number;
  chatCount: number;
  messageCount: number;
};

export type WhatsAppCompletedSync = {
  runId: string;
  mode: "initial" | "incremental";
  accountId: string;
  imported: number;
  duplicates: number;
  downloadFrom: string;
  downloadThrough: string;
};

export class WhatsAppRuntime {
  private readonly connector: ReadOnlyWhatsAppConnector;
  private readonly inbox: WhatsAppRawInbox;
  private readonly syncState: WhatsAppSyncState;
  private readonly accountId: string;
  private readonly store: Store;
  private readonly afterSuccessfulSync?: (
    sync: WhatsAppCompletedSync,
  ) => void | Promise<void>;
  private running = false;
  private lastSyncAt: string | null = null;
  private nextSyncAt: string | null = null;
  private importedLastRun = 0;
  private duplicatesLastRun = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    store: Store,
    connector: ReadOnlyWhatsAppConnector,
    accountId: string,
    afterSuccessfulSync?: (sync: WhatsAppCompletedSync) => void | Promise<void>,
  ) {
    this.store = store;
    this.connector = connector;
    this.accountId = accountId;
    this.afterSuccessfulSync = afterSuccessfulSync;
    this.inbox = new WhatsAppRawInbox(store);
    this.syncState = new WhatsAppSyncState(store);
    this.store.db.prepare("UPDATE whatsapp_sync_runs SET status='failed',error_code='SERVER_RESTARTED',completed_at=? WHERE account_id=? AND status='running'").run(new Date().toISOString(),accountId);
    const checkpoint = this.syncState.checkpoint(accountId);
    if (checkpoint) {
      this.lastSyncAt = checkpoint.lastSuccessfulRunAt;
      this.nextSyncAt = new Date(
        Date.parse(checkpoint.syncedThrough) + WHATSAPP_SYNC_INTERVAL_MS,
      ).toISOString();
    }
  }

  status(): WhatsAppRuntimeStatus {
    return {
      ...this.connector.status(),
      lastSyncAt: this.lastSyncAt,
      nextSyncAt: this.nextSyncAt,
      importedLastRun: this.importedLastRun,
      duplicatesLastRun: this.duplicatesLastRun,
      chatCount: Number(
        this.store.db
          .prepare(
            "SELECT COUNT(*) count FROM whatsapp_raw_chats WHERE account_id=?",
          )
          .get(this.accountId)!.count,
      ),
      messageCount: Number(
        this.store.db
          .prepare(
            "SELECT COUNT(*) count FROM whatsapp_raw_messages WHERE account_id=?",
          )
          .get(this.accountId)!.count,
      ),
    };
  }

  pairing(): WhatsAppPairingStatus {
    return this.connector.pairing();
  }

  async start(now = new Date().toISOString()) {
    if (!this.unsubscribe)
      this.unsubscribe = this.connector.subscribe(async (message) => {
        this.inbox.ingest(message);
      });
    await this.connector.connect();
    if (!this.nextSyncAt || this.nextSyncAt <= now) await this.runSync(now);
  }

  async tick(now = new Date().toISOString()) {
    if (
      !this.running &&
      this.connector.status().state === "connected" &&
      (!this.nextSyncAt || this.nextSyncAt <= now)
    )
      await this.runSync(now);
  }

  async runSync(now = new Date().toISOString()) {
    if (this.running) return;
    this.running = true;
    const run = this.syncState.start(this.accountId, now);
    let imported = 0;
    let duplicates = 0;
    let syncCompleted = false;
    const syncingConnector = this.connector as ReadOnlyWhatsAppConnector & {
      setSyncing?: (syncing: boolean) => void;
    };
    syncingConnector.setSyncing?.(true);
    try {
      for await (const message of this.connector.fetchMessages({
        from: run.downloadFrom,
        through: run.downloadThrough,
      })) {
        const result = this.inbox.ingest(
          message,
          new Date().toISOString(),
          run.id,
        );
        if (result.duplicate && !result.attachedToSync) duplicates += 1;
        else imported += 1;
      }
      const buffered = this.store.db
        .prepare(
          "UPDATE whatsapp_raw_messages SET sync_run_id=? WHERE account_id=? AND (sync_run_id IS NULL OR sync_run_id IN (SELECT id FROM whatsapp_sync_runs WHERE status='failed')) AND (sent_at>=? OR received_at>=?) AND sent_at<=?",
        )
        .run(
          run.id,
          this.accountId,
          run.downloadFrom,
          run.downloadFrom,
          run.downloadThrough,
        );
      imported += Number(buffered.changes);
      const completedAt = new Date().toISOString();
      this.syncState.succeed(run.id, { imported, duplicates }, completedAt);
      syncCompleted = true;
      this.lastSyncAt = completedAt;
      this.nextSyncAt = run.nextRunAt;
      this.importedLastRun = imported;
      this.duplicatesLastRun = duplicates;
      await this.afterSuccessfulSync?.({
        runId: run.id,
        mode: run.mode,
        accountId: this.accountId,
        imported,
        duplicates,
        downloadFrom: run.downloadFrom,
        downloadThrough: run.downloadThrough,
      });
    } catch (error) {
      if (!syncCompleted)
        this.syncState.fail(
          run.id,
          error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message)
            ? error.message
            : "WHATSAPP_SYNC_FAILED",
        );
      throw error;
    } finally {
      syncingConnector.setSyncing?.(false);
      this.running = false;
    }
  }

  async stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.connector.disconnect();
  }
}
