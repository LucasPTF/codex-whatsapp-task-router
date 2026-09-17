import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { Store } from "../../../packages/database/store.ts";
import { WorkflowService } from "../../../packages/core/service.ts";
import { ProjectService } from "../../../packages/core/project-service.ts";
import {
  AnalysisService,
  type AnalyzerOptions,
} from "../../../packages/core/analysis-service.ts";
import { DomainError, demand } from "../../../packages/core/model.ts";
import type { Role, Task, TaskStatus } from "../../../packages/core/model.ts";
import { parseAnalysis } from "../../../packages/contracts/validate.ts";
import { taskDocument } from "../../../packages/document-generator/index.ts";
import {
  hashPassword,
  normalizeUsername,
  Sessions,
  validateNewAccount,
  verifyPassword,
} from "./auth.ts";
import type { AppMode } from "./config.ts";
import { WhatsAppOnboarding } from "../../../packages/whatsapp/onboarding.ts";
import { AutomaticAnalysisCoordinator } from "../../../packages/core/automatic-analysis.ts";
async function body(
  req: IncomingMessage,
  maximumBytes = 65536,
): Promise<Record<string, unknown>> {
  demand(
    req.headers["content-type"]?.split(";")[0] === "application/json",
    "JSON_REQUIRED",
    415,
  );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    demand(size <= maximumBytes, "PAYLOAD_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    demand(
      value && typeof value === "object" && !Array.isArray(value),
      "INVALID_BODY",
      400,
    );
    return value;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError("INVALID_JSON", 400);
  }
}
export function createApp(
  store: Store,
  {
    uiRoot = resolve("dist/ui"),
    mode = "demo",
    analyzer: analyzerOptions = {
      enabled: false,
      executable: null,
      authFile: null,
      workspaceRoot: resolve("var/analysis-runs"),
      timeoutMs: 180000,
    },
    whatsappStatus = () => ({ state: "disabled", lastError: null }),
    whatsappPairing = () => ({ state: "disabled", qrDataUrl: null }),
    whatsappSync = async () => {
      throw new DomainError("WHATSAPP_DISABLED", 503);
    },
    whatsappAccountId = "primary",
  }: {
    uiRoot?: string;
    mode?: AppMode;
    analyzer?: AnalyzerOptions;
    whatsappStatus?: () => unknown;
    whatsappPairing?: () => unknown | Promise<unknown>;
    whatsappSync?: () => Promise<void>;
    whatsappAccountId?: string;
  } = {},
) {
  const workflow = new WorkflowService(store),
    projects = new ProjectService(store),
    sessions = new Sessions(store),
    analyzer = new AnalysisService(store, analyzerOptions),
    automaticAnalysis = new AutomaticAnalysisCoordinator(store, analyzer),
    whatsapp = new WhatsAppOnboarding(
      store,
      whatsappAccountId,
      mode === "demo",
    );
  let lastTick = new Date().toISOString();
  const limits = new Map<string, { count: number; reset: number }>();
  const tick = () => {
    const now = new Date().toISOString();
    workflow.dispatch(now);
    workflow.escalate(now);
    void automaticAnalysis
      .tick()
      .then(() => workflow.dispatch(new Date().toISOString()))
      .catch(() => console.error("automatic_analysis_failed"));
    lastTick = now;
  };
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    const json = (status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const host = req.headers.host ?? "";
      demand(/^(127\.0\.0\.1|localhost):\d+$/.test(host), "INVALID_HOST", 403);
      const origin = req.headers.origin;
      if (origin)
        demand(
          [
            `http://${host}`,
            "http://127.0.0.1:5173",
            "http://localhost:5173",
          ].includes(origin),
          "INVALID_ORIGIN",
          403,
        );
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname;
      if (path === "/api/health" && req.method === "GET")
        return json(200, {
          mode,
          whatsapp: whatsappStatus(),
          codex: analyzer.status(),
          lastTick,
        });
      if (path === "/api/login" && req.method === "POST") {
        const key = req.socket.remoteAddress ?? "local";
        const now = Date.now();
        let limit = limits.get(key);
        if (!limit || limit.reset < now) {
          limit = { count: 0, reset: now + 60000 };
          limits.set(key, limit);
        }
        demand(++limit.count <= 15, "LOGIN_RATE_LIMIT", 429);
        const b = await body(req);
        demand(
          typeof b.username === "string" &&
            typeof b.password === "string" &&
            b.password.length <= 200,
          "INVALID_LOGIN",
          400,
        );
        const employee = store.db
          .prepare("SELECT * FROM employees WHERE id=? AND active=1")
          .get(normalizeUsername(b.username));
        demand(
          employee &&
            verifyPassword(b.password, String(employee.password_hash)),
          "INVALID_CREDENTIALS",
          401,
        );
        const actor = {
          id: String(employee.id),
          role: employee.role as "manager" | "employee" | "admin",
        };
        return json(200, {
          token: sessions.issue(actor),
          actor,
          name: employee.name,
        });
      }
      if (path.startsWith("/api/")) {
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const actor = sessions.get(token);
        demand(actor, "UNAUTHORIZED", 401);
        if (path === "/api/logout" && req.method === "POST") {
          sessions.remove(token);
          return json(200, { ok: true });
        }
        if (path === "/api/whatsapp/pairing" && req.method === "GET") {
          demand(actor.role === "admin", "FORBIDDEN", 403);
          return json(200, await whatsappPairing());
        }
        if (path === "/api/whatsapp/groups" && req.method === "GET")
          return json(200, whatsapp.listGroups(actor));
        if (path === "/api/whatsapp/groups/map" && req.method === "POST") {
          const b = await body(req);
          demand(
            typeof b.conversationId === "string" &&
              Array.isArray(b.memberIds) &&
              b.memberIds.every((value) => typeof value === "string"),
            "INVALID_WHATSAPP_GROUP_MAPPING",
            400,
          );
          return json(
            201,
            whatsapp.mapGroup(actor, b.conversationId, b.memberIds as string[]),
          );
        }
        if (path === "/api/whatsapp/groups/ignore" && req.method === "POST") {
          const b = await body(req);
          demand(
            typeof b.conversationId === "string",
            "INVALID_WHATSAPP_GROUP_IGNORE",
            400,
          );
          return json(200, whatsapp.ignoreGroup(actor, b.conversationId));
        }
        if (path === "/api/whatsapp/groups/restore" && req.method === "POST") {
          const b = await body(req);
          demand(
            typeof b.conversationId === "string",
            "INVALID_WHATSAPP_GROUP_RESTORE",
            400,
          );
          return json(200, whatsapp.restoreGroup(actor, b.conversationId));
        }
        if (path === "/api/whatsapp/sync" && req.method === "POST") {
          demand(actor.role !== "employee", "FORBIDDEN", 403);
          await whatsappSync();
          return json(200, whatsappStatus());
        }
        if (path === "/api/tasks" && req.method === "GET")
          return json(200, workflow.list(actor));
        if (path === "/api/clients" && req.method === "GET")
          return json(200, projects.listClients(actor));
        if (path === "/api/clients" && req.method === "POST") {
          const b = await body(req);
          demand(typeof b.name === "string", "INVALID_CLIENT_BODY", 400);
          return json(201, { id: projects.createClient(actor, b.name) });
        }
        const clientMatch = path.match(/^\/api\/clients\/([\w-]+)$/);
        if (clientMatch && req.method === "POST") {
          const b = await body(req);
          demand(
            typeof b.name === "string" && typeof b.active === "boolean",
            "INVALID_CLIENT_BODY",
            400,
          );
          projects.updateClient(actor, clientMatch[1], {
            name: b.name,
            active: b.active,
          });
          return json(200, { ok: true });
        }
        if (path === "/api/projects" && req.method === "GET")
          return json(200, projects.listProjects(actor));
        if (path === "/api/analysis/automatic" && req.method === "GET")
          return json(200, automaticAnalysis.list(actor));
        if (path === "/api/analysis/automatic/retry" && req.method === "POST") {
          const result = automaticAnalysis.retryFailed(actor);
          tick();
          return json(200, result);
        }
        if (path === "/api/projects" && req.method === "POST") {
          const b = await body(req);
          demand(
            typeof b.clientId === "string" &&
              typeof b.name === "string" &&
              typeof b.description === "string" &&
              Array.isArray(b.memberIds) &&
              b.memberIds.every((value) => typeof value === "string") &&
              !!b.brief &&
              typeof b.brief === "object" &&
              !Array.isArray(b.brief),
            "INVALID_PROJECT_BODY",
            400,
          );
          const brief = b.brief as Record<string, unknown>;
          demand(
            ["objective", "offer", "audience", "channel", "restrictions"].every(
              (field) => typeof brief[field] === "string",
            ),
            "INVALID_BRIEF_BODY",
            400,
          );
          return json(201, {
            id: projects.createProject(actor, {
              clientId: b.clientId,
              name: b.name,
              description: b.description,
              memberIds: b.memberIds as string[],
              brief: brief as {
                objective: string;
                offer: string;
                audience: string;
                channel: string;
                restrictions: string;
              },
            }),
          });
        }
        const projectAnalysis = path.match(
          /^\/api\/projects\/([\w-]+)\/analysis-runs(?:\/(latest))?$/,
        );
        if (projectAnalysis) {
          const projectId = projectAnalysis[1];
          if (projectAnalysis[2] === "latest" && req.method === "GET")
            return json(200, analyzer.getLatest(actor, projectId));
          if (!projectAnalysis[2] && req.method === "POST")
            return json(202, analyzer.start(actor, projectId));
        }
        const analysisRun = path.match(
          /^\/api\/analysis-runs\/([\w-]+)(?:\/(cancel))?$/,
        );
        if (analysisRun) {
          if (!analysisRun[2] && req.method === "GET")
            return json(200, analyzer.getRun(actor, analysisRun[1]));
          if (analysisRun[2] === "cancel" && req.method === "POST") {
            analyzer.cancel(actor, analysisRun[1]);
            return json(200, { ok: true });
          }
        }
        const proposalReview = path.match(
          /^\/api\/analysis-proposals\/([\w-]+)\/(approve|reject)$/,
        );
        const proposalReanalysis=path.match(/^\/api\/analysis-proposals\/([\w-]+)\/reanalyze$/);
        if(proposalReanalysis && req.method==='POST') {
          const result=automaticAnalysis.reanalyzeProposal(actor,proposalReanalysis[1]);
          tick();return json(202,result);
        }
        if (proposalReview && req.method === "POST") {
          const result = analyzer.reviewProposal(
            actor,
            proposalReview[1],
            proposalReview[2] as "approve" | "reject",
          );
          automaticAnalysis.reconcileProposal(proposalReview[1]);
          if (proposalReview[2] === "approve") tick();
          return json(200, result);
        }
        const projectAction = path.match(
          /^\/api\/projects\/([\w-]+)(?:\/(brief|messages|import-preview|import-whatsapp))?$/,
        );
        if (projectAction) {
          const projectId = projectAction[1];
          const action = projectAction[2];
          if (!action && req.method === "GET")
            return json(200, projects.getProject(actor, projectId));
          if (!action && req.method === "POST") {
            const b = await body(req);
            demand(
              Number.isInteger(b.expectedRevision) &&
                typeof b.name === "string" &&
                typeof b.description === "string" &&
                typeof b.active === "boolean",
              "INVALID_PROJECT_UPDATE",
              400,
            );
            projects.updateProject(actor, projectId, {
              expectedRevision: Number(b.expectedRevision),
              name: b.name,
              description: b.description,
              active: b.active,
            });
            return json(200, { ok: true });
          }
          if (action === "brief" && req.method === "POST") {
            const b = await body(req);
            demand(
              Number.isInteger(b.expectedRevision) &&
                [
                  "objective",
                  "offer",
                  "audience",
                  "channel",
                  "restrictions",
                ].every((field) => typeof b[field] === "string"),
              "INVALID_BRIEF_BODY",
              400,
            );
            return json(200, {
              version: projects.saveBrief(actor, projectId, {
                expectedRevision: Number(b.expectedRevision),
                objective: String(b.objective),
                offer: String(b.offer),
                audience: String(b.audience),
                channel: String(b.channel),
                restrictions: String(b.restrictions),
              }),
            });
          }
          if (action === "messages" && req.method === "GET") {
            const urlLimit = Number(url.searchParams.get("limit") ?? 100);
            return json(200, projects.listMessages(actor, projectId, urlLimit));
          }
          if (action === "import-preview" && req.method === "POST") {
            const b = await body(req, 6 * 1024 * 1024);
            demand(
              typeof b.contents === "string" &&
                b.contents.length <= 5 * 1024 * 1024 &&
                typeof b.utcOffset === "string",
              "INVALID_IMPORT_BODY",
              400,
            );
            return json(
              200,
              projects.previewImport(actor, projectId, b.contents, b.utcOffset),
            );
          }
          if (action === "import-whatsapp" && req.method === "POST") {
            const b = await body(req, 6 * 1024 * 1024);
            demand(
              typeof b.filename === "string" &&
                typeof b.title === "string" &&
                typeof b.contents === "string" &&
                b.contents.length <= 5 * 1024 * 1024 &&
                typeof b.utcOffset === "string" &&
                Array.isArray(b.teamNames) &&
                b.teamNames.length <= 100 &&
                b.teamNames.every((value) => typeof value === "string"),
              "INVALID_IMPORT_BODY",
              400,
            );
            const result = projects.importConversation(actor, projectId, {
              filename: b.filename,
              title: b.title,
              contents: b.contents,
              utcOffset: b.utcOffset,
              teamNames: b.teamNames as string[],
            });
            return json(result.duplicate ? 200 : 201, result);
          }
        }
        const participantAction = path.match(
          /^\/api\/projects\/([\w-]+)\/participants\/([\w-]+)$/,
        );
        if (participantAction && req.method === "POST") {
          const b = await body(req);
          demand(
            typeof b.role === "string" &&
              ["client", "team", "unknown"].includes(b.role),
            "INVALID_PARTICIPANT_ROLE",
            400,
          );
          projects.updateParticipantRole(
            actor,
            participantAction[1],
            participantAction[2],
            b.role as "client" | "team" | "unknown",
          );
          return json(200, { ok: true });
        }
        if (path === "/api/tasks/manual" && req.method === "POST") {
          const b = await body(req);
          demand(
            typeof b.projectId === "string" &&
              typeof b.title === "string" &&
              typeof b.description === "string" &&
              typeof b.kind === "string" &&
              typeof b.priority === "string" &&
              (b.dueAt === null || typeof b.dueAt === "string") &&
              (b.assigneeId === null || typeof b.assigneeId === "string") &&
              Array.isArray(b.evidenceIds) &&
              b.evidenceIds.every((value) => typeof value === "string"),
            "INVALID_MANUAL_TASK_BODY",
            400,
          );
          const result = projects.createManualTask(actor, {
            projectId: b.projectId,
            title: b.title,
            description: b.description,
            kind: b.kind as Task["kind"],
            priority: b.priority as "low" | "normal" | "high" | "urgent",
            dueAt: b.dueAt as string | null,
            assigneeId: b.assigneeId as string | null,
            evidenceIds: b.evidenceIds as string[],
          });
          tick();
          return json(201, result);
        }
        if (path === "/api/notifications" && req.method === "GET")
          return json(
            200,
            store.db
              .prepare(
                "SELECT * FROM notifications WHERE employee_id=? ORDER BY created_at DESC LIMIT 100",
              )
              .all(actor.id),
          );
        if (path === "/api/admin/users" && req.method === "GET") {
          demand(actor.role === "admin", "FORBIDDEN", 403);
          const users = store.db
            .prepare(
              "SELECT id,name,role,active FROM employees ORDER BY name,id",
            )
            .all()
            .map((user) => ({
              ...user,
              capabilities: store.db
                .prepare(
                  "SELECT kind FROM capabilities WHERE employee_id=? ORDER BY kind",
                )
                .all(user.id!)
                .map((capability) => String(capability.kind)),
            }));
          return json(200, users);
        }
        if (path === "/api/admin/users" && req.method === "POST") {
          demand(actor.role === "admin", "FORBIDDEN", 403);
          const b = await body(req);
          demand(
            typeof b.username === "string" &&
              typeof b.name === "string" &&
              typeof b.role === "string" &&
              typeof b.password === "string" &&
              Array.isArray(b.capabilities) &&
              b.capabilities.length <= 20 &&
              b.capabilities.every(
                (value) =>
                  typeof value === "string" &&
                  /^[a-z][a-z0-9_-]{1,49}$/.test(value),
              ),
            "INVALID_ACCOUNT_BODY",
            400,
          );
          const account = validateNewAccount({
            username: b.username,
            name: b.name,
            role: b.role as Role,
            password: b.password,
          });
          demand(
            !store.db
              .prepare("SELECT 1 FROM employees WHERE id=?")
              .get(account.username),
            "ACCOUNT_EXISTS",
          );
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
            for (const capability of new Set(b.capabilities as string[]))
              store.db
                .prepare("INSERT INTO capabilities VALUES(?,?)")
                .run(account.username, capability);
            workflow.audit(
              actor.id,
              "user.created",
              account.username,
              { role: account.role, capabilities: b.capabilities },
              now,
            );
          });
          return json(201, { id: account.username });
        }
        const userAction = path.match(
          /^\/api\/admin\/users\/([a-z0-9._-]+)\/(deactivate|password)$/,
        );
        if (userAction && req.method === "POST") {
          demand(actor.role === "admin", "FORBIDDEN", 403);
          const employeeId = userAction[1];
          demand(
            store.db
              .prepare("SELECT 1 FROM employees WHERE id=?")
              .get(employeeId),
            "NOT_FOUND",
            404,
          );
          const now = new Date();
          if (userAction[2] === "deactivate") {
            demand(employeeId !== actor.id, "CANNOT_DEACTIVATE_SELF", 400);
            store.transaction(() => {
              store.db
                .prepare("UPDATE employees SET active=0 WHERE id=?")
                .run(employeeId);
              sessions.revokeEmployee(employeeId, now);
              workflow.audit(
                actor.id,
                "user.deactivated",
                employeeId,
                {},
                now.toISOString(),
              );
            });
          } else {
            const b = await body(req);
            demand(
              typeof b.password === "string",
              "INVALID_PASSWORD_BODY",
              400,
            );
            const password = b.password;
            validateNewAccount({
              username: employeeId,
              name: "Valid Name",
              role: "employee",
              password,
            });
            store.transaction(() => {
              store.db
                .prepare("UPDATE employees SET password_hash=? WHERE id=?")
                .run(hashPassword(password), employeeId);
              sessions.revokeEmployee(employeeId, now);
              workflow.audit(
                actor.id,
                "user.password_reset",
                employeeId,
                {},
                now.toISOString(),
              );
            });
          }
          return json(200, { ok: true });
        }
        if (path === "/api/admin/projects" && req.method === "GET") {
          demand(actor.role === "admin", "FORBIDDEN", 403);
          const projects = store.db
            .prepare("SELECT id,name,revision FROM projects ORDER BY name,id")
            .all()
            .map((project) => ({
              ...project,
              members: store.db
                .prepare(
                  "SELECT employee_id FROM project_members WHERE project_id=? ORDER BY employee_id",
                )
                .all(project.id!)
                .map((member) => String(member.employee_id)),
            }));
          return json(200, projects);
        }
        const projectMembers = path.match(
          /^\/api\/admin\/projects\/([\w-]+)\/members$/,
        );
        if (projectMembers && req.method === "POST") {
          demand(actor.role === "admin", "FORBIDDEN", 403);
          const b = await body(req);
          demand(
            typeof b.employeeId === "string" && typeof b.member === "boolean",
            "INVALID_MEMBERSHIP_BODY",
            400,
          );
          const memberEmployeeId = b.employeeId;
          const isMember = b.member;
          demand(
            store.db
              .prepare("SELECT 1 FROM projects WHERE id=?")
              .get(projectMembers[1]),
            "PROJECT_NOT_FOUND",
            404,
          );
          demand(
            store.db
              .prepare("SELECT 1 FROM employees WHERE id=? AND active=1")
              .get(memberEmployeeId),
            "EMPLOYEE_NOT_FOUND",
            404,
          );
          const now = new Date().toISOString();
          store.transaction(() => {
            if (isMember)
              store.db
                .prepare("INSERT OR IGNORE INTO project_members VALUES(?,?)")
                .run(projectMembers[1], memberEmployeeId);
            else
              store.db
                .prepare(
                  "DELETE FROM project_members WHERE project_id=? AND employee_id=?",
                )
                .run(projectMembers[1], memberEmployeeId);
            workflow.audit(
              actor.id,
              isMember ? "project.member_added" : "project.member_removed",
              projectMembers[1],
              { employeeId: memberEmployeeId },
              now,
            );
          });
          return json(200, { ok: true });
        }
        const readMatch = path.match(/^\/api\/notifications\/([\w-]+)\/read$/);
        if (readMatch && req.method === "POST") {
          const result = store.db
            .prepare(
              "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND employee_id=?",
            )
            .run(new Date().toISOString(), readMatch[1], actor.id);
          demand(result.changes === 1, "NOT_FOUND", 404);
          return json(200, { ok: true });
        }
        if (path === "/api/demo/scenario" && req.method === "POST") {
          demand(mode === "demo", "NOT_FOUND", 404);
          demand(actor.role === "admin", "FORBIDDEN", 403);
          const id = randomUUID(),
            now = new Date().toISOString();
          const event = {
            id,
            accountId: "demo-account",
            externalId: id,
            conversationId: "demo-group",
            projectId: "demo-campanha",
            senderId: "cliente-ficticio",
            direction: "incoming" as const,
            text: "Equipe de conteúdo, preciso revisar a copy desta campanha. Vamos destacar o atendimento personalizado, sem prometer resultados garantidos.",
            sentAt: now,
            source: "live" as const,
          };
          const { revision } = workflow.ingest(event, now);
          const analysis = parseAnalysis({
            projectId: "demo-campanha",
            projectRevision: revision,
            summary: "Cenário fictício. Cliente solicita revisão da copy.",
            messageDecisions: [],
            proposals: [
              {
                requestKey: "demo-revisao-copy",
                operation: 'upsert',
                expectedTaskVersion: null,
                title: "Revisar copy da campanha",
                description: event.text,
                kind: "copy",
                priority: "normal",
                dueAt: null,
                evidenceIds: [id],
                needsReview: false,
              },
            ],
          });
          const tasks = workflow.applyAnalysis(analysis, now);
          store.db
            .prepare("UPDATE jobs SET state='succeeded' WHERE dedupe_key=?")
            .run("analysis:demo-campanha:" + revision);
          tick();
          return json(201, { tasks, analysisMode: "fixture-not-ai" });
        }
        const match = path.match(
          /^\/api\/tasks\/([\w-]+)(?:\/(transition|assign|document))?$/,
        );
        if (match) {
          const id = match[1];
          const task = store.db
            .prepare("SELECT * FROM tasks WHERE id=?")
            .get(id) as unknown as Task | undefined;
          demand(task, "NOT_FOUND", 404);
          demand(
            workflow.allowed(actor, task.project_id) &&
              (actor.role !== "employee" || task.assignee_id === actor.id),
            "FORBIDDEN",
            403,
          );
          if (match[2] === "transition" && req.method === "POST") {
            const b = await body(req);
            demand(
              Number.isInteger(b.version) &&
                typeof b.status === "string" &&
                ["in_progress", "blocked", "done", "cancelled"].includes(
                  b.status,
                ) &&
                typeof b.note === "string",
              "INVALID_TRANSITION_BODY",
              400,
            );
            workflow.transition(
              actor,
              id,
              Number(b.version),
              b.status as TaskStatus,
              b.note,
            );
            tick();
            return json(200, { ok: true });
          }
          if (match[2] === "assign" && req.method === "POST") {
            const b = await body(req);
            demand(
              Number.isInteger(b.version) && typeof b.employeeId === "string",
              "INVALID_ASSIGNMENT",
              400,
            );
            workflow.assign(actor, id, b.employeeId, Number(b.version));
            tick();
            return json(200, { ok: true });
          }
          const evidence = store.db
            .prepare(
              "SELECT m.* FROM messages m JOIN task_evidence e ON e.message_id=m.id WHERE e.task_id=? ORDER BY m.sent_at",
            )
            .all(id);
          if (match[2] === "document" && req.method === "GET") {
            const bytes = await taskDocument(
              task,
              evidence as unknown as { text: string; sent_at: string }[],
            );
            res.writeHead(200, {
              "Content-Type":
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "Content-Disposition": `attachment; filename="Tarefa_${id}_V${task.version}.docx"`,
            });
            return res.end(bytes);
          }
          if (!match[2] && req.method === "GET")
            return json(200, { task, evidence });
        }
        throw new DomainError("NOT_FOUND", 404);
      }
      demand(req.method === "GET", "NOT_FOUND", 404);
      const decoded = decodeURIComponent(path);
      const absolute = resolve(uiRoot, "." + decoded);
      demand(
        absolute === uiRoot || absolute.startsWith(uiRoot + sep),
        "INVALID_PATH",
        400,
      );
      const filename = extname(absolute)
        ? absolute
        : resolve(uiRoot, "index.html");
      let bytes: Buffer;
      try {
        bytes = await readFile(filename);
      } catch {
        throw new DomainError("UI_NOT_BUILT_RUN_NPM_BUILD", 404);
      }
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(filename)] ?? "application/octet-stream",
      });
      res.end(bytes);
    } catch (e) {
      if (e instanceof DomainError) return json(e.status, { error: e.code });
      console.error("request_failed", e instanceof Error ? e.name : "unknown");
      json(500, { error: "INTERNAL_ERROR" });
    }
  });
  return {
    server,
    tick,
    sessions,
    workflow,
    projects,
    analyzer,
    automaticAnalysis,
  };
}
