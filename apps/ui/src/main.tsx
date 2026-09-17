import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Task } from "../../../packages/core/model.ts";
import "./style.css";
import { ProjectControl } from "./ProjectControl.tsx";
type Login = {
  token: string;
  actor: { id: string; role: string };
  name: string;
};
type Notice = {
  id: string;
  task_id: string;
  kind: string;
  read_at: string | null;
};
type UserAccount = {
  id: string;
  name: string;
  role: string;
  active: number;
  capabilities: string[];
};
type WhatsAppStatus = {
  state: string;
  lastError: string | null;
  lastSyncAt?: string | null;
  nextSyncAt?: string | null;
  importedLastRun?: number;
  chatCount?: number;
  messageCount?: number;
};
type AutomaticProposal = {
  operation: 'upsert' | 'complete' | 'cancel';
  id: string;
  title: string;
  description: string;
  kind: string;
  priority: string;
  due_at: string | null;
  project_id: string;
  project_name: string;
  evidenceIds: string[];
  client_message_first_sent_at: string | null;
  client_message_last_sent_at: string | null;
  client_message_count: number;
  client_response_due_at: string | null;
  client_response_sla_hours: number;
};
type AutomaticAnalysisState = {
  analyzer: { state: string; model: string | null };
  proposals: AutomaticProposal[];
  counts: Record<string, number>;
};
declare global {
  interface Window {
    desktop?: {
      copy: (text: string) => Promise<void>;
      notify: (title: string, body: string) => Promise<void>;
    };
  }
}
const labels: Record<string, string> = {
  open: "Aguardando aceite",
  in_progress: "Em andamento",
  blocked: "Bloqueada",
  done: "Concluída",
  cancelled: "Cancelada",
};
const taskKindLabels: Record<string, string> = {
  copy: "Copy",
  design: "Design",
  page: "Sites",
  strategy: "Funil / estratégia",
  service: "Atendimento",
  traffic: "Tráfego pago / pixel",
};
const formatClientDate = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
type WorkspaceView = "work" | "clients" | "notifications" | "accounts";
const workspaceViewCopy: Record<
  WorkspaceView,
  { eyebrow: string; title: string; description: string }
> = {
  work: {
    eyebrow: "ACOMPANHAMENTO DA EQUIPE",
    title: "Fila de trabalho",
    description: "Cada pedido com contexto, responsável e próximo passo.",
  },
  clients: {
    eyebrow: "OPERAÇÃO DO WHATSAPP",
    title: "Clientes e conversas",
    description: "Cadastre clientes, revise grupos e consulte as conversas.",
  },
  notifications: {
    eyebrow: "ACOMPANHAMENTO",
    title: "Central de notificações",
    description: "Veja atribuições, prazos e avisos da sua conta.",
  },
  accounts: {
    eyebrow: "ADMINISTRAÇÃO",
    title: "Contas da equipe",
    description: "Crie acessos e gerencie as pessoas cadastradas.",
  },
};
const whatsappLabels: Record<string, string> = {
  disabled: "desativado",
  initializing: "iniciando",
  qr_required: "aguardando leitura do QR Code",
  connected: "conectado",
  syncing: "sincronizando mensagens",
  disconnected: "desconectado",
  error: "com erro",
};
type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "controle-interno-theme";
function getInitialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // O tema ainda funciona quando o armazenamento do navegador está indisponível.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle secondary"
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      aria-pressed={isDark}
      onClick={onToggle}
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      {isDark ? "Modo claro" : "Modo escuro"}
    </button>
  );
}
function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [activeView, setActiveView] = useState<WorkspaceView>("work");
  const [login, setLogin] = useState<Login | null>(null),
    [mode, setMode] = useState<"demo" | "production" | null>(null),
    [analyzerStatus, setAnalyzerStatus] = useState<{
      state: string;
      model: string | null;
    }>({ state: "disabled", model: null }),
    [whatsappStatus, setWhatsAppStatus] = useState<WhatsAppStatus>({
      state: "disabled",
      lastError: null,
    }),
    [whatsappPairingQr, setWhatsAppPairingQr] = useState<string | null>(null),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]),
    [notices, setNotices] = useState<Notice[]>([]),
    [users, setUsers] = useState<UserAccount[]>([]),
    [automaticAnalysis, setAutomaticAnalysis] =
      useState<AutomaticAnalysisState>({
        analyzer: { state: "disabled", model: null },
        proposals: [],
        counts: {},
      }),
    [selected, setSelected] = useState<Task | null>(null),
    [evidence, setEvidence] = useState<
      { id: string; text: string; sent_at: string }[]
    >([]);
  const [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true);
  const [newUser, setNewUser] = useState({
    username: "",
    name: "",
    role: "employee",
    password: "",
    capabilities: "",
  });
  const seen = useRef(new Set<string>());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // A preferência apenas deixa de persistir quando o armazenamento falha.
    }
  }, [theme]);
  const toggleTheme = () =>
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  const unreadNoticeCount = notices.filter((notice) => !notice.read_at).length;
  const currentView = workspaceViewCopy[activeView];
  async function api(path: string, options: RequestInit = {}) {
    const r = await fetch("/api" + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(login ? { Authorization: "Bearer " + login.token } : {}),
        ...options.headers,
      },
    });
    if (!r.ok) {
      const e = await r.json();
      throw new Error(e.error);
    }
    return r;
  }
  async function refresh() {
    try {
      const [t, n, u, health, automatic] = await Promise.all([
        api("/tasks").then((r) => r.json()),
        api("/notifications").then((r) => r.json()),
        login?.actor.role === "admin"
          ? api("/admin/users").then((r) => r.json())
          : Promise.resolve([]),
        fetch("/api/health").then((r) => r.json()),
        login?.actor.role !== "employee"
          ? api("/analysis/automatic").then((r) => r.json())
          : Promise.resolve({
              analyzer: { state: "disabled", model: null },
              proposals: [],
              counts: {},
            }),
      ]);
      setTasks(t);
      setNotices(n);
      setUsers(u);
      setAutomaticAnalysis(automatic);
      setWhatsAppStatus(
        typeof health.whatsapp === "object"
          ? health.whatsapp
          : { state: "disabled", lastError: null },
      );
      if (
        login?.actor.role === "admin" &&
        health.whatsapp?.state === "qr_required"
      ) {
        const pairing = await api("/whatsapp/pairing").then((r) => r.json());
        setWhatsAppPairingQr(
          typeof pairing.qrDataUrl === "string" ? pairing.qrDataUrl : null,
        );
      } else {
        setWhatsAppPairingQr(null);
      }
      setOnline(true);
      for (const notice of n) {
        if (!notice.read_at && !seen.current.has(notice.id)) {
          seen.current.add(notice.id);
          if (window.desktop)
            void window.desktop
              .notify(
                "Pendência no Controle Interno",
                "Abra seu painel para acompanhar a tarefa.",
              )
              .catch(() => {});
        }
      }
    } catch {
      setOnline(false);
    }
  }
  useEffect(() => {
    void fetch("/api/health")
      .then((response) => response.json())
      .then((health) => {
        setMode(health.mode);
        setAnalyzerStatus(
          typeof health.codex === "object"
            ? health.codex
            : { state: "disabled", model: null },
        );
        setWhatsAppStatus(
          typeof health.whatsapp === "object"
            ? health.whatsapp
            : { state: "disabled", lastError: null },
        );
        if (health.mode === "demo") {
          setUsername("gestor");
          setPassword("demo-local-2026");
        }
      })
      .catch(() => setOnline(false));
  }, []);
  useEffect(() => {
    if (!login) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [login]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha inesperada");
    } finally {
      setBusy(false);
    }
  }
  async function openTask(task: Task) {
    await act(async () => {
      const r = await api("/tasks/" + task.id);
      const d = await r.json();
      setSelected(d.task);
      setEvidence(d.evidence);
      setNote("");
    });
  }
  async function transition(status: string) {
    if (!selected) return;
    await act(async () => {
      await api("/tasks/" + selected.id + "/transition", {
        method: "POST",
        body: JSON.stringify({ version: selected.version, status, note }),
      });
      setSelected(null);
      await refresh();
    });
  }
  async function download() {
    if (!selected) return;
    await act(async () => {
      const r = await api("/tasks/" + selected.id + "/document");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Tarefa_${selected.id}_V${selected.version}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setInfo("Documento de briefing preparado para download.");
    });
  }
  if (!login)
    return (
      <main className="login">
        <div className="login-heading">
          <div className="brand">
            CI <span>Controle Interno</span>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <h1>
          Pedidos claros.
          <br />
          Responsáveis definidos.
        </h1>
        <p>
          {mode === "demo"
            ? "Base de demonstração do gerenciamento de demandas da equipe."
            : "Acesso local ao gerenciamento interno da equipe."}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const r = await api("/login", {
                method: "POST",
                body: JSON.stringify({ username, password }),
              });
              setLogin(await r.json());
              setActiveView("work");
              seen.current.clear();
            });
          }}
        >
          <label>
            {mode === "demo" ? "Perfil de demonstração" : "Usuário"}
            {mode === "demo" ? (
              <select
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              >
                <option value="gestor">Gestor</option>
                <option value="magda">Ana · Conteúdo e estratégia</option>
                <option value="sabrina">Bia · Revisão e gestão</option>
                <option value="lucas">Caio · Sites</option>
                <option value="thay">Dani · Mídia paga</option>
              </select>
            ) : (
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>Entrar no painel</button>
        </form>
        <p className="warning">
          Ambiente local · WhatsApp{" "}
          {whatsappLabels[whatsappStatus.state] ?? whatsappStatus.state} · Codex{" "}
          {analyzerStatus.state === "ready" ? "conectado" : "desativado"}
        </p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          CI <span>Controle Interno</span>
        </div>
        <p className="eyebrow">ESPAÇO DE TRABALHO</p>
        <nav className="sidebar-nav" aria-label="Seções do aplicativo">
          <button
            type="button"
            className={activeView === "work" ? "active" : ""}
            aria-current={activeView === "work" ? "page" : undefined}
            onClick={() => setActiveView("work")}
          >
            Minhas demandas
          </button>
          {login.actor.role !== "employee" && (
            <button
              type="button"
              className={activeView === "clients" ? "active" : ""}
              aria-current={activeView === "clients" ? "page" : undefined}
              onClick={() => setActiveView("clients")}
            >
              Clientes e conversas
            </button>
          )}
          <button
            type="button"
            className={activeView === "notifications" ? "active" : ""}
            aria-current={activeView === "notifications" ? "page" : undefined}
            onClick={() => setActiveView("notifications")}
          >
            <span>Notificações</span>
            <b className="nav-count">{unreadNoticeCount}</b>
          </button>
          {login.actor.role === "admin" && (
            <button
              type="button"
              className={activeView === "accounts" ? "active" : ""}
              aria-current={activeView === "accounts" ? "page" : undefined}
              onClick={() => setActiveView("accounts")}
            >
              Contas da equipe
            </button>
          )}
        </nav>
        <div className="profile">
          <strong>{login.name}</strong>
          <small>
            {login.actor.role === "employee"
              ? "Funcionário"
              : login.actor.role === "admin"
                ? "Administrador"
                : "Gestão"}
          </small>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button
            className="secondary"
            onClick={() =>
              void act(async () => {
                await api("/logout", { method: "POST" });
                setLogin(null);
                setActiveView("work");
                setSelected(null);
                setWhatsAppPairingQr(null);
              })
            }
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header>
          <div>
            <p className="eyebrow">{currentView.eyebrow}</p>
            <h1>{currentView.title}</h1>
            <p>{currentView.description}</p>
          </div>
          {activeView === "clients" && login.actor.role !== "employee" && (
            <button
              disabled={busy || whatsappStatus.state === "syncing"}
              onClick={() =>
                void act(async () => {
                  await api("/whatsapp/sync", { method: "POST", body: "{}" });
                  await refresh();
                  setInfo(
                    "Sincronização concluída. Mensagens novas entraram na fila de análise.",
                  );
                })
              }
            >
              {whatsappStatus.state === "syncing"
                ? "Sincronizando…"
                : "Sincronizar agora"}
            </button>
          )}
        </header>
        <div className="banner">
          Ambiente local · Codex{" "}
          {analyzerStatus.state === "ready"
            ? "conectado sob comando"
            : "desativado"}
          ; WhatsApp{" "}
          {whatsappLabels[whatsappStatus.state] ?? whatsappStatus.state}
          {whatsappStatus.lastSyncAt
            ? ` · última coleta ${new Date(whatsappStatus.lastSyncAt).toLocaleString("pt-BR")}`
            : ""}
          {whatsappStatus.messageCount
            ? ` · ${whatsappStatus.messageCount} mensagens em ${whatsappStatus.chatCount ?? 0} conversas`
            : ""}
          .
        </div>
        {activeView === "clients" &&
          whatsappStatus.state === "qr_required" &&
          login.actor.role !== "employee" && (
            <section className="whatsapp-pairing" aria-live="polite">
              <div>
                <p className="eyebrow">VINCULAR WHATSAPP</p>
                <h2>Leia o QR Code pelo celular</h2>
                <p>
                  No WhatsApp, abra <strong>Aparelhos conectados</strong>, toque
                  em <strong>Conectar um aparelho</strong> e aponte a câmera
                  para o código. Esta aplicação não envia mensagens e não marca
                  conversas como lidas.
                </p>
                <small>
                  O código se renova automaticamente. Mantenha esta tela aberta
                  até aparecer “sincronizando mensagens”.
                </small>
              </div>
              {whatsappPairingQr ? (
                <img
                  src={whatsappPairingQr}
                  alt="QR Code para vincular o WhatsApp"
                />
              ) : (
                <div className="qr-loading">Preparando QR Code…</div>
              )}
            </section>
          )}
        {!online && (
          <p role="alert" className="error">
            Servidor indisponível. Dados podem estar desatualizados; tentando
            reconectar.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {info && <p role="status">{info}</p>}
        {activeView === "work" && (
          <>
            <div className="metrics">
              {[
                [
                  "Pendentes",
                  tasks.filter(
                    (task) => !["done", "cancelled"].includes(task.status),
                  ).length,
                ],
                [
                  "Sem aceite",
                  tasks.filter((task) => task.status === "open").length,
                ],
                [
                  "Bloqueadas",
                  tasks.filter((task) => task.status === "blocked").length,
                ],
                [
                  "Concluídas",
                  tasks.filter((task) => task.status === "done").length,
                ],
                ...(login.actor.role !== "employee"
                  ? [
                      ["Para revisão", automaticAnalysis.proposals.length] as [
                        string,
                        number,
                      ],
                    ]
                  : []),
              ].map(([label, count]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
            {login.actor.role !== "employee" && (
              <section className="automatic-analysis-panel">
                <div className="section-title">
                  <div>
                    <h2>Revisão da análise automática</h2>
                    <p>
                      Casos seguros são distribuídos automaticamente. Aqui ficam
                      somente os pedidos que precisam de uma decisão.
                    </p>
                  </div>
                  <span>
                    {automaticAnalysis.counts.pending ?? 0} na fila ·{" "}
                    {automaticAnalysis.counts.running ?? 0} analisando
                  </span>
                </div>
                {automaticAnalysis.analyzer.state !== 'ready' && (
                  <p role="status">Análise pausada: {automaticAnalysis.analyzer.state === 'codex_capacity_limit' ? 'limite de uso do Codex atingido. As mensagens continuam guardadas.' : automaticAnalysis.analyzer.state}. <button onClick={()=>void act(async()=>{await api('/analysis/automatic/retry',{method:'POST'});await refresh();})}>Retomar análise</button></p>
                )}
                {automaticAnalysis.counts.failed ? (
                  <p className="error">
                    {automaticAnalysis.counts.failed} lote(s) precisam ser
                    verificados por falha na análise.
                    <button onClick={() => void act(async () => {
                      await api('/analysis/automatic/retry', { method: 'POST' });
                      await refresh();
                    })}>Tentar novamente os lotes com falha</button>
                  </p>
                ) : null}
                {automaticAnalysis.proposals.length ? (
                  <div className="automatic-review-list">
                    {automaticAnalysis.proposals.map((proposal) => (
                      <article
                        className="automatic-review-card"
                        key={proposal.id}
                      >
                        <div>
                          <small>{proposal.project_name}</small>
                          <h3>{proposal.title}</h3>
                          <p>{proposal.description}</p>
                          <div className="automatic-review-meta">
                            <span className="badge">
                              {taskKindLabels[proposal.kind] ?? proposal.kind} ·{" "}
                              {proposal.priority}
                            </span>
                            {proposal.client_message_first_sent_at ? (
                              <span className="client-message-time">
                                Cliente enviou em{" "}
                                {formatClientDate(
                                  proposal.client_message_first_sent_at,
                                )}
                              </span>
                            ) : null}
                          </div>
                          {proposal.client_response_due_at ? (
                            <p
                              className={`client-response-deadline ${
                                Date.now() >
                                new Date(
                                  proposal.client_response_due_at,
                                ).getTime()
                                  ? "overdue"
                                  : "within-time"
                              }`}
                            >
                              Responder até{" "}
                              {formatClientDate(
                                proposal.client_response_due_at,
                              )}{" "}
                              · {proposal.client_response_sla_hours}h
                            </p>
                          ) : null}
                        </div>
                        <div className="automatic-review-actions">
                          <button className="secondary" onClick={()=>void act(async()=>{
                            await api(`/analysis-proposals/${proposal.id}/reanalyze`,{method:'POST'});
                            await refresh();
                          })}>Reavaliar com a conversa atual</button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await api(
                                  `/analysis-proposals/${proposal.id}/approve`,
                                  { method: "POST", body: "{}" },
                                );
                                await refresh();
                                setInfo("Demanda aprovada e encaminhada.");
                              })
                            }
                          >
                              {proposal.operation === 'complete' ? 'Confirmar conclusão' : proposal.operation === 'cancel' ? 'Confirmar cancelamento' : 'Aprovar e encaminhar'}
                          </button>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await api(
                                  `/analysis-proposals/${proposal.id}/reject`,
                                  { method: "POST", body: "{}" },
                                );
                                await refresh();
                                setInfo("Sugestão descartada.");
                              })
                            }
                          >
                            Descartar
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty-inline">
                    Nenhuma sugestão aguardando revisão.
                  </p>
                )}
              </section>
            )}
            <section>
              <div className="section-title">
                <h2>Minhas demandas</h2>
                <span>Atualizada a cada 5 segundos</span>
              </div>
              {!tasks.length ? (
                <div className="empty">
                  <h3>Nenhuma demanda por aqui.</h3>
                  <p>
                    {login.actor.role === "employee"
                      ? "As tarefas destinadas a você aparecerão aqui."
                      : "As tarefas dos projetos autorizados aparecerão aqui."}
                  </p>
                </div>
              ) : (
                tasks.map((task) => (
                  <button
                    className="task"
                    key={task.id}
                    onClick={() => void openTask(task)}
                  >
                    <span className={"dot " + task.status}></span>
                    <div>
                      <strong>{task.title}</strong>
                      <small>
                        {task.assignee_id ?? "Triagem"} ·{" "}
                        {taskKindLabels[task.kind] ?? task.kind} ·{" "}
                        {task.due_at
                          ? new Date(task.due_at).toLocaleString("pt-BR")
                          : "Prazo a definir"}
                      </small>
                    </div>
                    <span className="badge">{labels[task.status]}</span>
                  </button>
                ))
              )}
            </section>
          </>
        )}
        {activeView === "clients" && login.actor.role !== "employee" && (
          <ProjectControl
            role={login.actor.role}
            canManageWhatsAppGroups={
              login.actor.role === "admin" || mode === "demo"
            }
            accounts={users}
            api={api}
            report={(message, isError) => {
              if (isError) {
                setError(message);
                setInfo("");
              } else {
                setInfo(message);
                setError("");
              }
            }}
          />
        )}
        {activeView === "notifications" && (
          <section>
            <h2>Avisos recebidos</h2>
            {notices.length === 0 ? (
              <p>Nenhuma notificação.</p>
            ) : (
              notices.map((n) => (
                <div className="notice" key={n.id}>
                  <span>
                    {n.kind.startsWith("assignment")
                      ? "Nova atribuição"
                      : n.kind.startsWith("overdue")
                        ? "Prazo vencido"
                        : n.kind === "triage"
                          ? "Demanda em triagem"
                          : "Demanda aguardando aceite"}
                  </span>
                  <button
                    className="secondary"
                    disabled={!!n.read_at || busy}
                    onClick={() =>
                      void act(async () => {
                        await api("/notifications/" + n.id + "/read", {
                          method: "POST",
                          body: "{}",
                        });
                        await refresh();
                      })
                    }
                  >
                    {n.read_at ? "Visualizada" : "Marcar visualizada"}
                  </button>
                </div>
              ))
            )}
          </section>
        )}
        {activeView === "accounts" && login.actor.role === "admin" && (
          <section>
            <div className="section-title">
              <h2>Criar nova conta</h2>
              <span>Somente administradores</span>
            </div>
            <form
              className="account-form"
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await api("/admin/users", {
                    method: "POST",
                    body: JSON.stringify({
                      ...newUser,
                      capabilities: newUser.capabilities
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }),
                  });
                  setNewUser({
                    username: "",
                    name: "",
                    role: "employee",
                    password: "",
                    capabilities: "",
                  });
                  await refresh();
                  setInfo(
                    "Conta criada. O acesso pode ser revogado pelo administrador.",
                  );
                });
              }}
            >
              <label>
                Usuário
                <input
                  value={newUser.username}
                  onChange={(event) =>
                    setNewUser({ ...newUser, username: event.target.value })
                  }
                />
              </label>
              <label>
                Nome
                <input
                  value={newUser.name}
                  onChange={(event) =>
                    setNewUser({ ...newUser, name: event.target.value })
                  }
                />
              </label>
              <label>
                Papel
                <select
                  value={newUser.role}
                  onChange={(event) =>
                    setNewUser({ ...newUser, role: event.target.value })
                  }
                >
                  <option value="employee">Funcionário</option>
                  <option value="manager">Gestor</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label>
                Senha inicial
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser({ ...newUser, password: event.target.value })
                  }
                />
              </label>
              <label className="wide">
                Capacidades separadas por vírgula
                <input
                  placeholder="copy, page, design"
                  value={newUser.capabilities}
                  onChange={(event) =>
                    setNewUser({
                      ...newUser,
                      capabilities: event.target.value,
                    })
                  }
                />
              </label>
              <button disabled={busy}>Criar conta</button>
            </form>
            <h3 className="account-list-title">Contas cadastradas</h3>
            <div className="account-list">
              {users.map((user) => (
                <div key={user.id}>
                  <span>
                    <strong>{user.name}</strong>
                    <small>
                      {user.id} · {user.role} ·{" "}
                      {user.capabilities.join(", ") || "sem capacidade"}
                    </small>
                  </span>
                  <button
                    className="secondary"
                    disabled={
                      !user.active || user.id === login.actor.id || busy
                    }
                    onClick={() =>
                      void act(async () => {
                        await api(`/admin/users/${user.id}/deactivate`, {
                          method: "POST",
                          body: "{}",
                        });
                        await refresh();
                      })
                    }
                  >
                    {user.active ? "Desativar" : "Desativada"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      {selected && (
        <div className="overlay">
          <section
            className="detail"
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes da demanda"
          >
            <button className="secondary" onClick={() => setSelected(null)}>
              Fechar
            </button>
            <p className="eyebrow">
              {labels[selected.status]} · V{selected.version}
            </p>
            <h2>{selected.title}</h2>
            <p>{selected.description}</p>
            <h3>Evidências</h3>
            {evidence.map((e) => (
              <blockquote key={e.id}>
                {e.text}
                <small>{new Date(e.sent_at).toLocaleString("pt-BR")}</small>
              </blockquote>
            ))}
            <label>
              Resultado ou motivo
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Registre o material concluído ou o motivo do bloqueio."
              />
            </label>
            <div className="actions">
              {(selected.status === "open" ||
                selected.status === "blocked") && (
                <button
                  disabled={busy}
                  onClick={() => void transition("in_progress")}
                >
                  Assumir / retomar
                </button>
              )}
              {selected.status === "in_progress" && (
                <>
                  <button
                    disabled={busy}
                    onClick={() => void transition("done")}
                  >
                    Concluir
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void transition("blocked")}
                  >
                    Bloquear
                  </button>
                </>
              )}
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const text = note || selected.description;
                    if (window.desktop) await window.desktop.copy(text);
                    else await navigator.clipboard.writeText(text);
                    setInfo(
                      "Texto copiado. Isso não registra envio ao cliente.",
                    );
                  })
                }
              >
                Copiar texto
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void download()}
              >
                Baixar briefing Word
              </button>
            </div>
            <p className="hint">
              Conteúdo de demonstração. Skills de produção ainda não estão
              conectadas.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
