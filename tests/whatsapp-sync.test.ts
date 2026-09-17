import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/database/store.ts";
import {
  planWhatsAppSync,
  WhatsAppSyncState,
} from "../packages/whatsapp/sync.ts";

test("primeira sincronização busca um mês-calendário e agenda cinco horas", () => {
  const plan = planWhatsAppSync("2026-09-15T19:00:00.000Z", null);
  assert.deepEqual(plan, {
    mode: "initial",
    downloadFrom: "2026-08-15T19:00:00.000Z",
    downloadThrough: "2026-09-15T19:00:00.000Z",
    nextRunAt: "2026-09-16T00:00:00.000Z",
  });
  assert.equal(
    planWhatsAppSync("2026-03-31T12:00:00.000Z", null).downloadFrom,
    "2026-02-28T12:00:00.000Z",
  );
});

test("sincronização seguinte volta quinze minutos e não usa estado de leitura", () => {
  const plan = planWhatsAppSync("2026-09-15T22:00:00.000Z", {
    accountId: "conta-teste",
    syncedThrough: "2026-09-15T19:00:00.000Z",
    lastSuccessfulRunAt: "2026-09-15T19:02:00.000Z",
  });
  assert.equal(plan.mode, "incremental");
  assert.equal(plan.downloadFrom, "2026-09-15T18:45:00.000Z");
  assert.equal(plan.downloadThrough, "2026-09-15T22:00:00.000Z");
});

test("checkpoint só avança depois da sincronização completa", () => {
  const store = new Store();
  const state = new WhatsAppSyncState(store);
  try {
    const initial = state.start("conta-teste", "2026-09-15T19:00:00.000Z");
    assert.equal(initial.mode, "initial");
    assert.equal(state.checkpoint("conta-teste"), null);
    state.fail(initial.id, "PROVIDER_OFFLINE", "2026-09-15T19:01:00.000Z");
    assert.equal(state.checkpoint("conta-teste"), null);

    const retry = state.start("conta-teste", "2026-09-15T19:05:00.000Z");
    state.succeed(
      retry.id,
      { imported: 20, duplicates: 0 },
      "2026-09-15T19:06:00.000Z",
    );
    assert.deepEqual(state.checkpoint("conta-teste"), {
      accountId: "conta-teste",
      syncedThrough: "2026-09-15T19:05:00.000Z",
      lastSuccessfulRunAt: "2026-09-15T19:06:00.000Z",
    });

    const incremental = state.start("conta-teste", "2026-09-16T00:05:00.000Z");
    assert.equal(incremental.mode, "incremental");
    assert.equal(incremental.downloadFrom, "2026-09-15T18:50:00.000Z");
    state.succeed(
      incremental.id,
      { imported: 3, duplicates: 2 },
      "2026-09-16T00:06:00.000Z",
    );
    assert.equal(
      state.checkpoint("conta-teste")!.syncedThrough,
      "2026-09-16T00:05:00.000Z",
    );
  } finally {
    store.close();
  }
});
