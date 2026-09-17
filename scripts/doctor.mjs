import { spawnSync } from "node:child_process";
console.log("Node:", process.version, "| SO:", process.platform);
console.log(
  "Runtime alvo: Node 24 LTS >=24.14. Banco node:sqlite é decisão de protótipo a homologar.",
);
const result = spawnSync("codex", ["--version"], {
  shell: false,
  encoding: "utf8",
  timeout: 10000,
});
console.log(
  result.error
    ? "Codex CLI não detectado pelo comando direto. Verificar instalação e, no Windows, caminho do executável nativo."
    : result.stdout.trim(),
);
console.log(
  "Não inicia login, não lê credenciais, não conecta WhatsApp e não consome IA.",
);
