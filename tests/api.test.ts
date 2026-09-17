import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/database/store.ts";
import { seedDemo } from "../apps/server/src/auth.ts";
import { createApp } from "../apps/server/src/server.ts";
test("HTTP: login, atribuição, autorização, Word e conclusão", async () => {
  const store = new Store();
  seedDemo(store);
  const { server } = createApp(store);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
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
    assert.equal((await request("/api/tasks")).status, 401);
    const login = async (username: string) =>
      (
        await (
          await request("/api/login", "", {
            username,
            password: "demo-local-2026",
          })
        ).json()
      ).token as string;
    const manager = await login("gestor"),
      magda = await login("magda"),
      lucas = await login("lucas");
    assert.equal((await request("/api/demo/scenario", magda, {})).status, 403);
    assert.equal(
      (await request("/api/demo/scenario", manager, {})).status,
      201,
    );
    const tasks = await (await request("/api/tasks", magda)).json();
    assert.equal(tasks.length, 1);
    const task = tasks[0];
    assert.equal((await request("/api/tasks/" + task.id, lucas)).status, 403);
    const doc = await request("/api/tasks/" + task.id + "/document", magda);
    assert.equal(doc.status, 200);
    assert.match(doc.headers.get("content-type")!, /wordprocessingml/);
    const bytes = Buffer.from(await doc.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert(bytes.length > 1000);
    assert.equal(
      (
        await request("/api/tasks/" + task.id + "/transition", magda, {
          version: 1,
          status: "in_progress",
          note: "",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/tasks/" + task.id + "/transition", magda, {
          version: 1,
          status: "done",
          note: "Entrega pronta",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/api/tasks/" + task.id + "/transition", magda, {
          version: 2,
          status: "done",
          note: "Documento revisado e salvo",
        })
      ).status,
      200,
    );
    assert.equal((await request("/api/send", manager, {})).status, 404);
  } finally {
    await new Promise<void>((r, e) =>
      server.close((err) => (err ? e(err) : r())),
    );
    store.close();
  }
});
