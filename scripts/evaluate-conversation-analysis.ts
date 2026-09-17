import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/database/store.ts";
import { seedDemo } from "../apps/server/src/auth.ts";
import { loadConfig } from "../apps/server/src/config.ts";
import { AnalysisService } from "../packages/core/analysis-service.ts";
import { WorkflowService } from "../packages/core/service.ts";
import { resolveWhatsAppTeamIdentity } from "../packages/whatsapp/team-directory.ts";

// Synthetic cases derived from business rules. This runner never touches the live DB.
const cases = [
  { name: "explicit-selection", required: ["page"], forbidden: ["traffic"], messages: [
    ["team", "Apresentamos cinco funis. O funil 3 é o recomendado."],
    ["client", "Escolhi o funil 3, podem seguir."],
  ] },
  { name: "aline-handoff", required: ["page", "copy", "strategy"], forbidden: [], messages: [
    ["team", "Enviei documentos com cinco funis. Escolha um deles. Sugiro aula em 17/10."],
    ["client", "Li os materiais, obrigada pelo trabalho. Aceito o título Jornada da Autoestima. Gostei de todas as sugestões e estou em dúvida sobre o melhor funil. Devo manter os mentores convidados? Isso altera meu faturamento."],
    ["team", "Agora as equipes de conteúdo e web vão trabalhar com base nesse funil e tirar suas dúvidas dos produtos."],
    ["client", "Quero confirmar a data 17/11."],
    ["team", "Assim que terminar página e copy mando aqui para aprovação."],
  ] },
  { name: "praise-is-not-selection", required: [], forbidden: ["page", "copy", "traffic", "design"], messages: [
    ["team", "Aqui estão os cinco funis. Fico aguardando sua escolha."],
    ["client", "Obrigada, gostei de todos. Ainda não escolhi, vou ler com calma amanhã."],
  ] },
  { name: "delivered-and-no-new-work", required: [], forbidden: ["page", "copy", "traffic", "design", "strategy", "service"], messages: [
    ["client", "Corrija a cor do botão da página."],
    ["team", "Corrigi a cor do botão e publiquei a página atualizada."],
    ["client", "Conferi. Está correto, aprovada. Obrigada!"],
  ] },
  { name: "parallel-deliverables", required: ["page", "design", "traffic"], forbidden: [], messages: [
    ["client", "Quero alterar o layout da página, criar dois anúncios estáticos e corrigir o pixel que não registra compras."],
  ] },
];
const config = loadConfig();
const effort = process.argv[2] === "medium" ? "medium" : "high";
const fileIndex = process.argv.indexOf("--aline-file");
if (fileIndex >= 0) {
  const directoryStore = new Store();
  seedDemo(directoryStore);
  const text = readFileSync(process.argv[fileIndex + 1], "utf8");
  const messages: string[][] = [];
  for (const match of text.matchAll(/\[\d+\/\d+\/\d+, [^\]]+\] ([^:]+): ([\s\S]*?)(?=\n\[\d+\/\d+\/\d+, |$)/g)) {
    const sender = match[1].replace(/\D/g, "") + "@s.whatsapp.net";
    messages.push([resolveWhatsAppTeamIdentity(directoryStore, "primary", sender) ? "team" : "client", match[2].trim()]);
  }
  directoryStore.close();
  if (!messages.length) throw new Error("NO_MESSAGES_IN_FILE");
  cases.splice(0, cases.length, { name: "aline-complete-private-txt", required: ["page", "copy"], forbidden: [], messages });
}
let failures = 0;
for (const scenario of cases) {
  const directory = mkdtempSync(join(tmpdir(), "conversation-eval-"));
  const store = new Store();
  seedDemo(store);
  for (const role of ["client", "team"])
    store.db.prepare("INSERT INTO participants(id,project_id,display_name,role,created_at,external_sender_id) VALUES(?,?,?,?,?,?)").run(role, "demo-campanha", role, role, new Date().toISOString(), role);
  const workflow = new WorkflowService(store);
  const ids: string[] = [];
  scenario.messages.forEach(([role, text], index) => {
    const id = `${scenario.name}-${index}`;
    ids.push(id);
    workflow.ingest({ id, accountId: "eval", externalId: id, projectId: "demo-campanha", conversationId: "eval", senderId: role, direction: "incoming", text, sentAt: new Date(Date.UTC(2026, 8, 15, 12, index)).toISOString(), source: "import" });
  });
  const analyzer = new AnalysisService(store, { ...config.analyzer, enabled: true, model: "gpt-5.6-sol", reasoningEffort: effort, workspaceRoot: directory, timeoutMs: 180000 });
  try {
    const run = analyzer.start({ id: "gestor", role: "admin" }, "demo-campanha", new Date().toISOString(), { mode: "recovery", focusMessageIds: ids });
    await analyzer.wait(String(run.id));
    const result = analyzer.getRun({ id: "gestor", role: "admin" }, String(run.id));
    const kinds = result.proposals.map((proposal) => String(proposal.kind));
    const passed = result.status === "succeeded" && scenario.required.every((kind) => kinds.includes(kind)) && scenario.forbidden.every((kind) => !kinds.includes(kind));
    if (!passed) failures++;
    console.log(JSON.stringify({ case: scenario.name, effort, passed, status: result.status, error: result.error_code, kinds, proposals: result.proposals.map((p) => ({ title: p.title, description: p.description, kind: p.kind, needsReview: p.needs_review })) }));
  } finally {
    await analyzer.shutdown();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
process.exitCode = failures ? 1 : 0;
