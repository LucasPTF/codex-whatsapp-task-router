import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/database/store.ts";
import {
  bootstrapProductionAdmin,
  seedDemo,
  Sessions,
} from "../apps/server/src/auth.ts";
import { loadConfig } from "../apps/server/src/config.ts";
import { createApp } from "../apps/server/src/server.ts";

test("configuração separa bancos de demonstração e produção", () => {
  const demo = loadConfig({}, "C:\\app");
  const production = loadConfig({ APP_MODE: "production" }, "C:\\app");
  assert.equal(demo.mode, "demo");
  assert.match(demo.databasePath, /demo\.sqlite$/);
  assert.match(production.databasePath, /production\.sqlite$/);
  assert.equal(demo.analyzer.enabled, false);
  assert.equal(demo.whatsapp.enabled, false);
  assert.match(demo.whatsapp.authPath, /whatsapp-auth$/);
  assert.match(demo.analyzer.workspaceRoot, /analysis-runs$/);
  assert.throws(
    () => loadConfig({ APP_MODE: "invalid" }, "C:\\app"),
    /APP_MODE_MUST_BE_DEMO_OR_PRODUCTION/,
  );
  assert.throws(
    () => loadConfig({ CODEX_ANALYZER_ENABLED: "yes" }, "C:\\app"),
    /CODEX_ANALYZER_ENABLED_MUST_BE_TRUE_OR_FALSE/,
  );
  assert.throws(
    () => loadConfig({ WHATSAPP_CONNECTOR_ENABLED: "yes" }, "C:\\app"),
    /WHATSAPP_CONNECTOR_ENABLED_MUST_BE_TRUE_OR_FALSE/,
  );
  const enabled = loadConfig(
    {
      CODEX_ANALYZER_ENABLED: "true",
      CODEX_EXECUTABLE: process.execPath,
      CODEX_ANALYZER_MODEL: "gpt-5.6-luna",
      USERPROFILE: process.env.USERPROFILE,
    },
    "C:\\app",
  );
  assert.equal(enabled.analyzer.enabled, true);
  assert.equal(enabled.analyzer.executable, process.execPath);
  assert.equal(enabled.analyzer.model, "gpt-5.6-luna");
});

test("produção exige bootstrap e nunca cria o seed de demonstração", () => {
  const store = new Store();
  try {
    assert.throws(
      () => bootstrapProductionAdmin(store, {}),
      /PRODUCTION_BOOTSTRAP_REQUIRED/,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM employees").get()!.count,
      0,
    );
    assert.equal(
      bootstrapProductionAdmin(store, {
        username: "Admin.Local",
        name: "Administrador Local",
        password: "senha-inicial-segura",
      }),
      true,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM employees").get()!.count,
      1,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) count FROM projects").get()!.count,
      0,
    );
    assert.equal(bootstrapProductionAdmin(store, {}), false);
  } finally {
    store.close();
  }
});

test("sessão sobrevive ao reinício e revoga imediatamente", () => {
  const directory = mkdtempSync(join(tmpdir(), "controle-identity-"));
  const path = join(directory, "db.sqlite");
  const first = new Store(path);
  try {
    seedDemo(first);
    const token = new Sessions(first).issue({ id: "magda", role: "employee" });
    first.close();
    const second = new Store(path);
    try {
      assert.deepEqual(new Sessions(second).get(token), {
        id: "magda",
        role: "manager",
      });
      new Sessions(second).revokeEmployee("magda");
      assert.equal(new Sessions(second).get(token), null);
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("QR do WhatsApp exige sessão de gestão e não aparece na saúde pública", async () => {
  const store = new Store();
  seedDemo(store);
  const qrDataUrl = "data:image/png;base64,segredo";
  const { server } = createApp(store, {
    whatsappStatus: () => ({ state: "qr_required", lastError: null }),
    whatsappPairing: () => ({ state: "qr_required", qrDataUrl }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const login = async (username: string) => {
    const response = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "demo-local-2026" }),
    });
    return ((await response.json()) as { token: string }).token;
  };
  try {
    const health = await (await fetch(base + "/api/health")).text();
    assert.doesNotMatch(health, /segredo/);
    const manager = await login("gestor");
    const pairing = await fetch(base + "/api/whatsapp/pairing", {
      headers: { Authorization: `Bearer ${manager}` },
    });
    assert.equal(pairing.status, 200);
    assert.equal(
      ((await pairing.json()) as { qrDataUrl: string }).qrDataUrl,
      qrDataUrl,
    );
    const employee = await login("magda");
    assert.equal(
      (
        await fetch(base + "/api/whatsapp/pairing", {
          headers: { Authorization: `Bearer ${employee}` },
        })
      ).status,
      403,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
  }
});

test("produção cria contas reais, limita gestor por projeto e revoga acesso", async () => {
  const store = new Store();
  bootstrapProductionAdmin(store, {
    username: "admin",
    name: "Administrador",
    password: "senha-inicial-segura",
  });
  store.db.exec(
    "INSERT INTO projects(id,name) VALUES('projeto-a','Projeto A'),('projeto-b','Projeto B')",
  );
  const now = "2026-09-15T12:00:00.000Z";
  const addTask = store.db.prepare(
    "INSERT INTO tasks(id,project_id,request_key,title,description,kind,priority,created_at,acknowledge_by) VALUES(?,?,?,?,?,'copy','normal',?,?)",
  );
  addTask.run("tarefa-a", "projeto-a", "a", "Tarefa A", "Projeto A", now, now);
  addTask.run("tarefa-b", "projeto-b", "b", "Tarefa B", "Projeto B", now, now);
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
        Authorization: "Bearer " + token,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  try {
    const login = async (username: string, password: string) => {
      const response = await request("/api/login", "", { username, password });
      assert.equal(response.status, 200);
      return ((await response.json()) as { token: string }).token;
    };
    const admin = await login("admin", "senha-inicial-segura");
    assert.equal(
      (
        await request("/api/admin/users", admin, {
          username: "gestor-a",
          name: "Gestor A",
          role: "manager",
          password: "senha-do-gestor-a",
          capabilities: [],
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request("/api/admin/projects/projeto-a/members", admin, {
          employeeId: "gestor-a",
          member: true,
        })
      ).status,
      200,
    );
    const manager = await login("gestor-a", "senha-do-gestor-a");
    const tasks = (await (await request("/api/tasks", manager)).json()) as {
      id: string;
    }[];
    assert.deepEqual(
      tasks.map((task) => task.id),
      ["tarefa-a"],
    );
    assert.equal((await request("/api/tasks/tarefa-b", manager)).status, 403);
    assert.equal(
      (
        await request("/api/admin/users", manager, {
          username: "intruso",
          name: "Intruso",
          role: "employee",
          password: "senha-nao-autorizada",
          capabilities: [],
        })
      ).status,
      403,
    );
    assert.equal((await request("/api/demo/scenario", admin, {})).status, 404);
    assert.equal(
      (
        await request("/api/admin/users/gestor-a/password", admin, {
          password: "senha-nova-do-gestor",
        })
      ).status,
      200,
    );
    assert.equal((await request("/api/tasks", manager)).status, 401);
    const renewedManager = await login("gestor-a", "senha-nova-do-gestor");
    assert.equal(
      (await request("/api/admin/users/gestor-a/deactivate", admin, {})).status,
      200,
    );
    assert.equal((await request("/api/tasks", renewedManager)).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
  }
});
