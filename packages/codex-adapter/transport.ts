import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
export type RunSpec = {
  executable: string;
  workspace: string;
  schemaPath: string;
  outputPath: string;
  model?: string;
  reasoningEffort?: "medium" | "high";
  prompt: string;
  timeoutMs: number;
  maxOutputBytes: number;
  environment: NodeJS.ProcessEnv;
};
export type RunResult = { exitCode: number; jsonl: string };
export function classifyExecutionFailure(stderr: string, code: number | null) {
  if (/invalid.*schema|schema.*invalid|required.*properties|invalid_json_schema/i.test(stderr)) return 'CODEX_INVALID_SCHEMA';
  if (/model.*not.*(available|supported|exist)|unsupported.*model|model_not_found/i.test(stderr)) return 'CODEX_MODEL_UNAVAILABLE';
  if (/unknown feature|unexpected argument|unrecognized/i.test(stderr)) return 'CODEX_CONFIGURATION_ERROR';
  if (/usage limit|quota|rate.limit|too many requests|insufficient_quota/i.test(stderr)) return 'CODEX_CAPACITY_LIMIT';
  if (/unauthorized|authentication|token.*expired|refresh.token|not logged in|401/i.test(stderr)) return 'CODEX_AUTH_EXPIRED';
  if (/connection|network|dns|timed out|stream disconnected/i.test(stderr)) return 'CODEX_CONNECTION_FAILED';
  return 'CODEX_EXIT_' + (code ?? 'UNKNOWN');
}
/** Transporte do analisador. O chamador homologa paths/config, materializa somente
 * a skill autorizada e mantém revisão humana antes de persistir propostas.
 * O modo read-only e a ausência da ferramenta de shell são barreiras adicionais,
 * não uma prova completa de isolamento entre clientes.
 */
export function executeCodex(
  spec: RunSpec,
  signal?: AbortSignal,
): Promise<RunResult> {
  if (
    ![spec.executable, spec.workspace, spec.schemaPath, spec.outputPath].every(
      isAbsolute,
    )
  )
    return Promise.reject(new Error("ABSOLUTE_PATHS_REQUIRED"));
  if (/\.(cmd|bat)$/i.test(spec.executable))
    return Promise.reject(new Error("NATIVE_EXECUTABLE_REQUIRED"));
  if (
    !Number.isInteger(spec.timeoutMs) ||
    spec.timeoutMs < 1 ||
    spec.maxOutputBytes < 1
  )
    return Promise.reject(new Error("INVALID_LIMITS"));
  if (signal?.aborted) return Promise.reject(new Error("CANCELLED"));
  return new Promise((resolve, reject) => {
    let output = "",
      diagnostic = "",
      bytes = 0,
      settled = false;
    const argumentsList = [
      "--ask-for-approval",
      "never",
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--disable",
      "shell_tool",
      "--disable",
      "remote_plugin",
      "--disable",
      "skill_mcp_dependency_install",
      "--disable",
      "plugins",
      "--disable",
      "apps",
      "--disable",
      "browser_use",
      "--disable",
      "browser_use_external",
      "--disable",
      "browser_use_full_cdp_access",
      "--disable",
      "computer_use",
      "--disable",
      "in_app_browser",
      "--disable",
      "multi_agent",
      "--disable",
      "hooks",
      "--disable",
      "workspace_dependencies",
      "--disable",
      "tool_suggest",
      "--disable",
      "shell_snapshot",
      "--json",
      "--color",
      "never",
      "--skip-git-repo-check",
      "--output-schema",
      spec.schemaPath,
      "-o",
      spec.outputPath,
    ];
    if (spec.model) argumentsList.push("--model", spec.model);
    if (spec.reasoningEffort)
      argumentsList.push("-c", `model_reasoning_effort="${spec.reasoningEffort}"`);
    argumentsList.push("-");
    const child = spawn(spec.executable, argumentsList, {
      cwd: spec.workspace,
      shell: false,
      env: spec.environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        // Caminho do sistema deve ser homologado no instalador. Sem shell e somente PID numérico próprio.
        const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
        spawn(
          systemRoot + "\\System32\\taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { shell: false, windowsHide: true, stdio: "ignore" },
        ).on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const fail = (code: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      terminate();
      reject(new Error(code));
    };
    const cancel = () => fail("CANCELLED");
    const timer = setTimeout(() => fail("TIMEOUT"), spec.timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > spec.maxOutputBytes) fail("OUTPUT_LIMIT");
      else output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString('utf8')).slice(-16000);
      bytes += chunk.length;
      if (bytes > spec.maxOutputBytes) fail("OUTPUT_LIMIT");
    });
    child.stdin.on("error", () => {});
    child.on("error", () => fail("SPAWN_FAILED"));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (code === 0) resolve({ exitCode: 0, jsonl: output });
      else reject(new Error(classifyExecutionFailure(diagnostic + output, code)));
    });
    child.stdin.end(spec.prompt);
  });
}
