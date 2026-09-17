import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { Store } from "../../../packages/database/store.ts";
import type { Actor, Role } from "../../../packages/core/model.ts";
import { DomainError } from "../../../packages/core/model.ts";
import { seedDemoWhatsAppTeamDirectory } from "../../../packages/whatsapp/team-directory.ts";
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 32).toString("hex");
}
export function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeUsername(username: string) {
  return username.trim().toLocaleLowerCase("pt-BR");
}

export function validateNewAccount(input: {
  username: string;
  name: string;
  role: Role;
  password: string;
}) {
  const username = normalizeUsername(input.username);
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username))
    throw new DomainError("INVALID_USERNAME", 400);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100)
    throw new DomainError("INVALID_NAME", 400);
  if (!["admin", "manager", "employee"].includes(input.role))
    throw new DomainError("INVALID_ROLE", 400);
  if (input.password.length < 12 || input.password.length > 200)
    throw new DomainError("WEAK_PASSWORD", 400);
  return { ...input, username, name };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export class Sessions {
  store: Store;
  ttlMs: number;
  constructor(store: Store, ttlMs = 8 * 3600000) {
    this.store = store;
    this.ttlMs = ttlMs;
  }
  issue(actor: Actor, now = new Date()) {
    const token = randomBytes(32).toString("hex");
    this.store.db
      .prepare(
        "INSERT INTO user_sessions(token_hash,employee_id,created_at,expires_at) VALUES(?,?,?,?)",
      )
      .run(
        tokenHash(token),
        actor.id,
        now.toISOString(),
        new Date(now.getTime() + this.ttlMs).toISOString(),
      );
    return token;
  }
  get(token: string, now = new Date()): Actor | null {
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const session = this.store.db
      .prepare(
        "SELECT e.id,e.role FROM user_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND e.active=1",
      )
      .get(tokenHash(token), now.toISOString());
    if (!session) return null;
    return { id: String(session.id), role: session.role as Role };
  }
  remove(token: string, now = new Date()) {
    if (!/^[0-9a-f]{64}$/.test(token)) return;
    this.store.db
      .prepare(
        "UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE token_hash=?",
      )
      .run(now.toISOString(), tokenHash(token));
  }
  revokeEmployee(employeeId: string, now = new Date()) {
    this.store.db
      .prepare(
        "UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE employee_id=?",
      )
      .run(now.toISOString(), employeeId);
  }
}

export function bootstrapProductionAdmin(
  store: Store,
  input: { username?: string; name?: string; password?: string },
) {
  const existing = Number(
    store.db
      .prepare("SELECT COUNT(*) count FROM employees WHERE role='admin'")
      .get()!.count,
  );
  if (existing > 0) return false;
  if (!input.username || !input.name || !input.password)
    throw new DomainError("PRODUCTION_BOOTSTRAP_REQUIRED", 500);
  const account = validateNewAccount({
    username: input.username,
    name: input.name,
    password: input.password,
    role: "admin",
  });
  const now = new Date().toISOString();
  store.transaction(() => {
    store.db
      .prepare(
        "INSERT INTO employees(id,name,role,password_hash) VALUES(?,?,?,?)",
      )
      .run(
        account.username,
        account.name,
        account.role,
        hashPassword(account.password),
      );
    store.db
      .prepare(
        "INSERT INTO audit_logs(actor_id,action,entity_id,payload,created_at) VALUES('system','user.bootstrap',?,?,?)",
      )
      .run(account.username, JSON.stringify({ role: "admin" }), now);
  });
  return true;
}
export function seedDemo(s: Store) {
  s.transaction(() => {
    const profiles: Array<{
      id: string;
      name: string;
      role: Role;
      capabilities: string[];
      autoAssign: boolean;
    }> = [
      {
        id: "gestor",
        name: "Gestor",
        role: "admin",
        capabilities: [],
        autoAssign: false,
      },
      {
        id: "magda",
        name: "Ana · Conteúdo",
        role: "manager",
        capabilities: ["copy", "design", "strategy", "service"],
        autoAssign: true,
      },
      {
        id: "sabrina",
        name: "Bia · Revisão",
        role: "manager",
        capabilities: ["copy", "design", "strategy", "service"],
        autoAssign: false,
      },
      {
        id: "lucas",
        name: "Caio · Web",
        role: "employee",
        capabilities: ["page"],
        autoAssign: true,
      },
      {
        id: "thay",
        name: "Dani · Mídia",
        role: "employee",
        capabilities: ["traffic"],
        autoAssign: true,
      },
    ];
    for (const { id, name, role, capabilities, autoAssign } of profiles) {
      if (!s.db.prepare("SELECT id FROM employees WHERE id=?").get(id))
        s.db
          .prepare(
            "INSERT INTO employees(id,name,role,password_hash,auto_assign) VALUES(?,?,?,?,?)",
          )
          .run(
            id,
            name,
            role,
            hashPassword("demo-local-2026"),
            autoAssign ? 1 : 0,
          );
      else
        s.db
          .prepare(
            "UPDATE employees SET name=?,role=?,active=1,auto_assign=? WHERE id=?",
          )
          .run(name, role, autoAssign ? 1 : 0, id);
      s.db.prepare("DELETE FROM capabilities WHERE employee_id=?").run(id);
      for (const capability of capabilities)
        s.db
          .prepare("INSERT INTO capabilities VALUES(?,?)")
          .run(id, capability);
    }
    s.db
      .prepare(
        "INSERT OR IGNORE INTO projects(id,name) VALUES('demo-campanha','Campanha de demonstração')",
      )
      .run();
    const hasRealProjects = Boolean(
      s.db
        .prepare(
          "SELECT 1 FROM projects WHERE id<>'demo-campanha' AND client_id IS NOT NULL LIMIT 1",
        )
        .get(),
    );
    s.db
      .prepare("UPDATE projects SET active=? WHERE id='demo-campanha'")
      .run(hasRealProjects ? 0 : 1);
    const projects = s.db.prepare("SELECT id FROM projects").all();
    for (const project of projects)
      for (const { id } of profiles)
        s.db
          .prepare("INSERT OR IGNORE INTO project_members VALUES(?,?)")
          .run(project.id, id);
    seedDemoWhatsAppTeamDirectory(s);
  });
}
