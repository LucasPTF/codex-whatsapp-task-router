import { resolve } from "node:path";
import { existsSync } from "node:fs";

export type AppMode = "demo" | "production";

export type AppConfig = {
  mode: AppMode;
  port: number;
  dataDir: string;
  databasePath: string;
  analyzer: {
    enabled: boolean;
    executable: string | null;
    authFile: string | null;
    model?: string;
    reasoningEffort: "medium" | "high";
    workspaceRoot: string;
    timeoutMs: number;
  };
  whatsapp: {
    enabled: boolean;
    accountId: string;
    authPath: string;
  };
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): AppConfig {
  const mode = environment.APP_MODE ?? "demo";
  if (mode !== "demo" && mode !== "production")
    throw new Error("APP_MODE_MUST_BE_DEMO_OR_PRODUCTION");
  const port = Number(environment.PORT ?? 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("INVALID_PORT");
  const dataDir = resolve(workingDirectory, environment.DATA_DIR ?? "var");
  const analyzerEnabledValue = environment.CODEX_ANALYZER_ENABLED ?? "false";
  if (!["true", "false"].includes(analyzerEnabledValue))
    throw new Error("CODEX_ANALYZER_ENABLED_MUST_BE_TRUE_OR_FALSE");
  const configuredExecutable = environment.CODEX_EXECUTABLE
    ? resolve(environment.CODEX_EXECUTABLE)
    : environment.LOCALAPPDATA
      ? resolve(
          environment.LOCALAPPDATA,
          "Programs",
          "OpenAI",
          "Codex",
          "bin",
          "codex.exe",
        )
      : null;
  const configuredCodexHome = environment.CODEX_HOME
    ? resolve(environment.CODEX_HOME)
    : environment.USERPROFILE
      ? resolve(environment.USERPROFILE, ".codex")
      : null;
  const authFile = configuredCodexHome
    ? resolve(configuredCodexHome, "auth.json")
    : null;
  const analyzerTimeoutMs = Number(
    environment.CODEX_ANALYZER_TIMEOUT_MS ?? 180000,
  );
  if (
    !Number.isInteger(analyzerTimeoutMs) ||
    analyzerTimeoutMs < 30000 ||
    analyzerTimeoutMs > 600000
  )
    throw new Error("INVALID_CODEX_ANALYZER_TIMEOUT");
  const analyzerModel = environment.CODEX_ANALYZER_MODEL?.trim() || "gpt-5.6-sol";
  const reasoningEffort = environment.CODEX_ANALYZER_REASONING_EFFORT ?? "high";
  if (reasoningEffort !== "medium" && reasoningEffort !== "high")
    throw new Error("INVALID_CODEX_ANALYZER_REASONING_EFFORT");
  if (analyzerModel && !/^[a-zA-Z0-9._-]{1,100}$/.test(analyzerModel))
    throw new Error("INVALID_CODEX_ANALYZER_MODEL");
  const whatsappEnabledValue =
    environment.WHATSAPP_CONNECTOR_ENABLED ?? "false";
  if (!["true", "false"].includes(whatsappEnabledValue))
    throw new Error("WHATSAPP_CONNECTOR_ENABLED_MUST_BE_TRUE_OR_FALSE");
  const whatsappAccountId =
    environment.WHATSAPP_ACCOUNT_ID?.trim() || "primary";
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(whatsappAccountId))
    throw new Error("INVALID_WHATSAPP_ACCOUNT_ID");
  return {
    mode,
    port,
    dataDir,
    databasePath: resolve(
      dataDir,
      mode === "demo" ? "demo.sqlite" : "production.sqlite",
    ),
    analyzer: {
      enabled: analyzerEnabledValue === "true",
      executable:
        configuredExecutable && existsSync(configuredExecutable)
          ? configuredExecutable
          : null,
      authFile: authFile && existsSync(authFile) ? authFile : null,
      ...(analyzerModel ? { model: analyzerModel } : {}),
      reasoningEffort,
      workspaceRoot: resolve(dataDir, "analysis-runs"),
      timeoutMs: analyzerTimeoutMs,
    },
    whatsapp: {
      enabled: whatsappEnabledValue === "true",
      accountId: whatsappAccountId,
      authPath: resolve(dataDir, "whatsapp-auth"),
    },
  };
}
