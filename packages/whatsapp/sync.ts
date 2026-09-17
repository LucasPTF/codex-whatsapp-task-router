import { randomUUID } from "node:crypto";
import { Store } from "../database/store.ts";

export const WHATSAPP_SYNC_INTERVAL_MS = 5 * 60 * 60 * 1000;
export const WHATSAPP_SYNC_OVERLAP_MS = 15 * 60 * 1000;

export type WhatsAppSyncCheckpoint = {
  accountId: string;
  syncedThrough: string;
  lastSuccessfulRunAt: string;
};

export type WhatsAppSyncWindow = {
  mode: "initial" | "incremental";
  downloadFrom: string;
  downloadThrough: string;
  nextRunAt: string;
};

type SyncRunRow = {
  id: string;
  account_id: string;
  status: "running" | "succeeded" | "failed";
  requested_through: string;
};

function validDate(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`INVALID_${field}`);
  return parsed;
}

function oneCalendarMonthBefore(value: Date) {
  const targetMonth = value.getUTCMonth() - 1;
  const targetYear =
    targetMonth < 0 ? value.getUTCFullYear() - 1 : value.getUTCFullYear();
  const normalizedMonth = targetMonth < 0 ? 11 : targetMonth;
  const maximumDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(value.getUTCDate(), maximumDay),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    ),
  );
}

export function planWhatsAppSync(
  now: string,
  checkpoint: WhatsAppSyncCheckpoint | null,
): WhatsAppSyncWindow {
  const current = validDate(now, "SYNC_TIME");
  const downloadFrom = checkpoint
    ? new Date(
        validDate(checkpoint.syncedThrough, "SYNC_CHECKPOINT").getTime() -
          WHATSAPP_SYNC_OVERLAP_MS,
      )
    : oneCalendarMonthBefore(current);
  return {
    mode: checkpoint ? "incremental" : "initial",
    downloadFrom: downloadFrom.toISOString(),
    downloadThrough: current.toISOString(),
    nextRunAt: new Date(
      current.getTime() + WHATSAPP_SYNC_INTERVAL_MS,
    ).toISOString(),
  };
}

export class WhatsAppSyncState {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  checkpoint(accountId: string): WhatsAppSyncCheckpoint | null {
    const row = this.store.db
      .prepare(
        "SELECT account_id,synced_through,last_successful_run_at FROM whatsapp_sync_checkpoints WHERE account_id=?",
      )
      .get(accountId);
    if (!row) return null;
    return {
      accountId: String(row.account_id),
      syncedThrough: String(row.synced_through),
      lastSuccessfulRunAt: String(row.last_successful_run_at),
    };
  }

  start(accountId: string, now = new Date().toISOString()) {
    if (!accountId.trim()) throw new Error("INVALID_WHATSAPP_ACCOUNT");
    const plan = planWhatsAppSync(now, this.checkpoint(accountId));
    const id = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO whatsapp_sync_runs(id,account_id,mode,requested_from,requested_through,status,started_at) VALUES(?,?,?,?,?,'running',?)",
      )
      .run(
        id,
        accountId,
        plan.mode,
        plan.downloadFrom,
        plan.downloadThrough,
        now,
      );
    return { id, ...plan };
  }

  succeed(
    runId: string,
    counts: { imported: number; duplicates: number },
    completedAt = new Date().toISOString(),
  ) {
    if (
      !Number.isInteger(counts.imported) ||
      counts.imported < 0 ||
      !Number.isInteger(counts.duplicates) ||
      counts.duplicates < 0
    )
      throw new Error("INVALID_SYNC_COUNTS");
    validDate(completedAt, "SYNC_COMPLETION");
    this.store.transaction(() => {
      const run = this.store.db
        .prepare("SELECT * FROM whatsapp_sync_runs WHERE id=?")
        .get(runId) as unknown as SyncRunRow | undefined;
      if (!run) throw new Error("SYNC_RUN_NOT_FOUND");
      if (run.status !== "running") throw new Error("SYNC_RUN_NOT_RUNNING");
      this.store.db
        .prepare(
          "UPDATE whatsapp_sync_runs SET status='succeeded',completed_at=?,imported_count=?,duplicate_count=? WHERE id=?",
        )
        .run(completedAt, counts.imported, counts.duplicates, runId);
      this.store.db
        .prepare(
          "INSERT INTO whatsapp_sync_checkpoints(account_id,synced_through,last_successful_run_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET synced_through=excluded.synced_through,last_successful_run_at=excluded.last_successful_run_at WHERE excluded.synced_through>whatsapp_sync_checkpoints.synced_through",
        )
        .run(run.account_id, run.requested_through, completedAt);
    });
  }

  fail(
    runId: string,
    errorCode: string,
    completedAt = new Date().toISOString(),
  ) {
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(errorCode))
      throw new Error("INVALID_SYNC_ERROR");
    validDate(completedAt, "SYNC_COMPLETION");
    const result = this.store.db
      .prepare(
        "UPDATE whatsapp_sync_runs SET status='failed',completed_at=?,error_code=? WHERE id=? AND status='running'",
      )
      .run(completedAt, errorCode, runId);
    if (result.changes !== 1) throw new Error("SYNC_RUN_NOT_RUNNING");
  }
}
