import React, { useEffect, useMemo, useState } from "react";

type Client = {
  id: string;
  name: string;
  active: number;
  project_count: number;
};
type Member = {
  id: string;
  name: string;
  role: string;
  active: number;
  capabilities: string[];
};
type Brief = {
  version: number;
  objective: string;
  offer: string;
  audience: string;
  channel: string;
  restrictions: string;
};
type Project = {
  id: string;
  name: string;
  client_name: string;
  description: string;
  revision: number;
  active: number;
  brief: Brief | null;
  members: Member[];
  participants: { id: string; display_name: string; role: string }[];
  conversations: {
    id: string;
    title: string;
    captured_from: string | null;
    captured_through: string | null;
  }[];
};
type Message = {
  id: string;
  direction: "incoming" | "outgoing";
  text: string;
  sent_at: string;
  sender_name: string;
  sender_role: string;
};
type Account = { id: string; name: string; active: number; role: string };
type WhatsAppGroup = {
  conversationId: string;
  title: string;
  firstCapturedAt: string;
  lastCapturedAt: string;
  projectId: string | null;
  messageCount: number;
  mappingState: "pending" | "mapped" | "ignored";
  mappingMethod: "manual" | "automatic" | null;
  autoEligible: boolean;
  classificationReasons: string[];
};
type Api = (path: string, options?: RequestInit) => Promise<Response>;

const emptyBrief = {
  objective: "",
  offer: "",
  audience: "",
  channel: "WhatsApp",
  restrictions: "",
};

export function ProjectControl({
  role,
  accounts,
  canManageWhatsAppGroups,
  api,
  report,
}: {
  role: string;
  accounts: Account[];
  canManageWhatsAppGroups: boolean;
  api: Api;
  report: (message: string, error?: boolean) => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [whatsappGroups, setWhatsAppGroups] = useState<WhatsAppGroup[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [clientName, setClientName] = useState("");
  const [projectDraft, setProjectDraft] = useState({
    clientId: "",
    name: "",
    description: "",
    memberIds: [] as string[],
    brief: { ...emptyBrief },
  });
  const [briefDraft, setBriefDraft] = useState({ ...emptyBrief });
  const selected =
    projects.find((project) => project.id === selectedId) ?? null;
  const whatsappGroupBuckets = useMemo(() => {
    const query = groupSearch.trim().toLocaleLowerCase("pt-BR");
    const buckets = {
      pending: [] as WhatsAppGroup[],
      mapped: [] as WhatsAppGroup[],
      ignored: [] as WhatsAppGroup[],
    };
    for (const group of whatsappGroups) {
      if (query && !group.title.toLocaleLowerCase("pt-BR").includes(query))
        continue;
      buckets[group.mappingState].push(group);
    }
    for (const groups of Object.values(buckets))
      groups.sort((left, right) =>
        left.title.localeCompare(right.title, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        }),
      );
    return buckets;
  }, [groupSearch, whatsappGroups]);
  const visibleProjects = useMemo(() => {
    const query = projectSearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return projects;
    return projects.filter((project) =>
      `${project.client_name} ${project.name}`
        .toLocaleLowerCase("pt-BR")
        .includes(query),
    );
  }, [projectSearch, projects]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    report("");
    try {
      await action();
    } catch (error) {
      report(error instanceof Error ? error.message : "Falha inesperada", true);
    } finally {
      setBusy(false);
    }
  }
  async function loadWorkspace(preferredProjectId?: string) {
    const [clientData, projectData, groupData] = await Promise.all([
      api("/clients").then((response) => response.json()),
      api("/projects").then((response) => response.json()),
      canManageWhatsAppGroups
        ? api("/whatsapp/groups").then((response) => response.json())
        : Promise.resolve([]),
    ]);
    setClients(clientData);
    setProjects(projectData);
    setWhatsAppGroups(groupData);
    setProjectDraft((current) => ({
      ...current,
      clientId: current.clientId || clientData[0]?.id || "",
    }));
    const nextId = preferredProjectId ?? selectedId ?? projectData[0]?.id ?? "";
    if (nextId && projectData.some((project: Project) => project.id === nextId))
      setSelectedId(nextId);
    else setSelectedId(projectData[0]?.id ?? "");
  }
  async function loadMessages(projectId: string) {
    if (!projectId) return setMessages([]);
    const response = await api(`/projects/${projectId}/messages?limit=100`);
    setMessages(await response.json());
  }
  async function ignoreWhatsAppGroup(group: WhatsAppGroup) {
    await api("/whatsapp/groups/ignore", {
      method: "POST",
      body: JSON.stringify({ conversationId: group.conversationId }),
    });
    await loadWorkspace();
    report(
      `“${group.title}” entrou na lista “Não analisar”. O histórico bruto foi mantido.`,
    );
  }
  async function restoreWhatsAppGroup(group: WhatsAppGroup) {
    const response = await api("/whatsapp/groups/restore", {
      method: "POST",
      body: JSON.stringify({ conversationId: group.conversationId }),
    });
    const result = await response.json();
    await loadWorkspace(result.projectId ?? undefined);
    report(
      result.mappingState === "mapped"
        ? `“${group.title}” foi restaurado e ${result.importedMessages} mensagens do período bloqueado foram recuperadas.`
        : `“${group.title}” voltou para a lista de revisão.`,
    );
  }
  useEffect(() => {
    void run(() => loadWorkspace());
  }, []);
  useEffect(() => {
    void run(() => loadMessages(selectedId));
  }, [selectedId]);
  useEffect(() => {
    const project = projects.find((item) => item.id === selectedId);
    setBriefDraft(
      project?.brief
        ? {
            objective: project.brief.objective,
            offer: project.brief.offer,
            audience: project.brief.audience,
            channel: project.brief.channel,
            restrictions: project.brief.restrictions,
          }
        : { ...emptyBrief },
    );
  }, [selectedId, selected?.brief?.version]);

  return (
    <section className="project-control">
      <div className="section-title">
        <div>
          <h2>Gerenciamento de clientes</h2>
          <p>
            Consulte os grupos coletados, os clientes reconhecidos e o histórico
            sincronizado automaticamente.
          </p>
        </div>
        <span>Sincronização e análise automáticas</span>
      </div>

      {canManageWhatsAppGroups && (
        <div className="whatsapp-management">
          <label className="group-search">
            Pesquisar pelo número ou nome do grupo
            <input
              type="search"
              value={groupSearch}
              onChange={(event) => setGroupSearch(event.target.value)}
              placeholder="Ex.: 012 ou nome do cliente"
            />
          </label>

          <details className="panel whatsapp-groups" open>
            <summary>
              <strong>Grupos para revisar</strong>
              <span>{whatsappGroupBuckets.pending.length} pendentes</span>
            </summary>
            <p>
              Escolha se cada conversa é cliente ou se deve entrar na lista “Não
              analisar”.
            </p>
            <div className="whatsapp-group-list">
              {whatsappGroupBuckets.pending.map((group) => (
                <article
                  className="whatsapp-group-row"
                  key={group.conversationId}
                >
                  <div>
                    <strong>{group.title}</strong>
                    <small>{group.messageCount} mensagens coletadas</small>
                  </div>
                  <div className="group-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const response = await api("/whatsapp/groups/map", {
                            method: "POST",
                            body: JSON.stringify({
                              conversationId: group.conversationId,
                              memberIds: [],
                            }),
                          });
                          const result = await response.json();
                          await loadWorkspace(result.projectId);
                          report(
                            `Cliente e projeto “${result.title}” cadastrados com ${result.messageCount} mensagens.`,
                          );
                        })
                      }
                    >
                      É cliente
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void run(() => ignoreWhatsAppGroup(group))}
                    >
                      Não é cliente
                    </button>
                  </div>
                </article>
              ))}
              {!whatsappGroupBuckets.pending.length && (
                <p className="empty-inline">Nenhum grupo aguardando revisão.</p>
              )}
            </div>
          </details>

          <details className="panel whatsapp-groups">
            <summary>
              <strong>Clientes cadastrados pelo WhatsApp</strong>
              <span>{whatsappGroupBuckets.mapped.length} cadastrados</span>
            </summary>
            <p>
              O título foi preservado. Use “Não é cliente” se algum grupo entrou
              por engano.
            </p>
            <div className="whatsapp-group-list">
              {whatsappGroupBuckets.mapped.slice(0, 100).map((group) => (
                <article
                  className="whatsapp-group-row"
                  key={group.conversationId}
                >
                  <div>
                    <strong>{group.title}</strong>
                    <small>{group.messageCount} mensagens coletadas</small>
                  </div>
                  <div className="group-actions">
                    <span className="mapped-label">
                      {group.mappingMethod === "automatic"
                        ? "Criado automaticamente"
                        : "Cadastrado"}
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void run(() => ignoreWhatsAppGroup(group))}
                    >
                      Não é cliente
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {whatsappGroupBuckets.mapped.length > 100 && (
              <small>
                Mostrando os primeiros 100 resultados. Refine a pesquisa para
                localizar outro grupo.
              </small>
            )}
          </details>

          <details className="panel whatsapp-groups blocked-groups">
            <summary>
              <strong>Não analisar</strong>
              <span>{whatsappGroupBuckets.ignored.length} bloqueados</span>
            </summary>
            <p>
              Essas conversas continuam guardadas na caixa bruta, mas não entram
              em clientes, projetos ou análises. Você pode restaurar a qualquer
              momento.
            </p>
            <div className="whatsapp-group-list">
              {whatsappGroupBuckets.ignored.map((group) => (
                <article
                  className="whatsapp-group-row"
                  key={group.conversationId}
                >
                  <div>
                    <strong>{group.title}</strong>
                    <small>{group.messageCount} mensagens preservadas</small>
                  </div>
                  <div className="group-actions">
                    <span className="blocked-label">Não analisar</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() => restoreWhatsAppGroup(group))
                      }
                    >
                      Retirar da lista
                    </button>
                  </div>
                </article>
              ))}
              {!whatsappGroupBuckets.ignored.length && (
                <p className="empty-inline">Nenhuma conversa está bloqueada.</p>
              )}
            </div>
          </details>
        </div>
      )}

      {role === "admin" && (
        <div className="setup-grid">
          <form
            className="panel compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api("/clients", {
                  method: "POST",
                  body: JSON.stringify({ name: clientName }),
                });
                setClientName("");
                await loadWorkspace();
                report("Cliente cadastrado.");
              });
            }}
          >
            <h3>Novo cliente</h3>
            <label>
              Nome do cliente
              <input
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                required
              />
            </label>
            <button disabled={busy}>Cadastrar cliente</button>
          </form>
          <form
            className="panel project-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const response = await api("/projects", {
                  method: "POST",
                  body: JSON.stringify(projectDraft),
                });
                const created = await response.json();
                setProjectDraft({
                  clientId: clients[0]?.id ?? "",
                  name: "",
                  description: "",
                  memberIds: [],
                  brief: { ...emptyBrief },
                });
                await loadWorkspace(created.id);
                report("Projeto e briefing cadastrados.");
              });
            }}
          >
            <h3>Novo projeto/conversa</h3>
            <div className="form-grid">
              <label>
                Cliente
                <select
                  value={projectDraft.clientId}
                  onChange={(event) =>
                    setProjectDraft({
                      ...projectDraft,
                      clientId: event.target.value,
                    })
                  }
                  required
                >
                  <option value="">Selecione</option>
                  {clients
                    .filter((client) => client.active)
                    .map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Nome do projeto
                <input
                  value={projectDraft.name}
                  onChange={(event) =>
                    setProjectDraft({
                      ...projectDraft,
                      name: event.target.value,
                    })
                  }
                  required
                />
              </label>
              <label className="wide">
                Descrição
                <textarea
                  value={projectDraft.description}
                  onChange={(event) =>
                    setProjectDraft({
                      ...projectDraft,
                      description: event.target.value,
                    })
                  }
                />
              </label>
              {(
                [
                  "objective",
                  "offer",
                  "audience",
                  "channel",
                  "restrictions",
                ] as const
              ).map((field) => (
                <label key={field}>
                  {
                    {
                      objective: "Objetivo",
                      offer: "Oferta",
                      audience: "Público",
                      channel: "Canal",
                      restrictions: "Restrições",
                    }[field]
                  }
                  <input
                    value={projectDraft.brief[field]}
                    onChange={(event) =>
                      setProjectDraft({
                        ...projectDraft,
                        brief: {
                          ...projectDraft.brief,
                          [field]: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <fieldset>
              <legend>Equipe autorizada neste projeto</legend>
              <div className="check-grid">
                {accounts
                  .filter(
                    (account) => account.active && account.role !== "admin",
                  )
                  .map((account) => (
                    <label key={account.id}>
                      <input
                        type="checkbox"
                        checked={projectDraft.memberIds.includes(account.id)}
                        onChange={(event) =>
                          setProjectDraft({
                            ...projectDraft,
                            memberIds: event.target.checked
                              ? [...projectDraft.memberIds, account.id]
                              : projectDraft.memberIds.filter(
                                  (id) => id !== account.id,
                                ),
                          })
                        }
                      />
                      {account.name}
                    </label>
                  ))}
              </div>
            </fieldset>
            <button disabled={busy || !clients.length}>Criar projeto</button>
          </form>
        </div>
      )}

      <label className="project-search">
        Pesquisar cliente pelo número ou nome
        <input
          type="search"
          value={projectSearch}
          onChange={(event) => setProjectSearch(event.target.value)}
          placeholder="Ex.: 253 ou Ana Cláudia"
        />
      </label>
      <div
        className="project-tabs"
        role="tablist"
        aria-label="Projetos autorizados"
      >
        {visibleProjects.map((project) => (
          <button
            role="tab"
            aria-selected={project.id === selectedId}
            className={project.id === selectedId ? "active" : "secondary"}
            key={project.id}
            onClick={() => setSelectedId(project.id)}
          >
            {project.client_name &&
            project.client_name.localeCompare(project.name, "pt-BR", {
              sensitivity: "base",
            }) !== 0
              ? `${project.client_name} · ${project.name}`
              : project.name}
          </button>
        ))}
      </div>
      {projectSearch && !visibleProjects.length && (
        <p className="empty-inline">Nenhum cliente encontrado.</p>
      )}

      {selected ? (
        <div className="conversation-workspace">
          <div className="panel">
            <p className="eyebrow">PROJETO SELECIONADO</p>
            <h3>{selected.name}</h3>
            <p>{selected.description || "Sem descrição."}</p>
            <small>
              Equipe:{" "}
              {selected.members.map((member) => member.name).join(", ") ||
                "ninguém"}
            </small>
            <div className="participant-list">
              <small>Participantes identificados</small>
              {selected.participants.length ? (
                selected.participants.map((participant) => (
                  <label key={participant.id}>
                    <span>{participant.display_name}</span>
                    <select
                      value={participant.role}
                      onChange={(event) =>
                        void run(async () => {
                          await api(
                            `/projects/${selected.id}/participants/${participant.id}`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                role: event.target.value,
                              }),
                            },
                          );
                          await loadWorkspace(selected.id);
                          report("Tipo do participante atualizado.");
                        })
                      }
                    >
                      <option value="client">Cliente</option>
                      <option value="team">Equipe</option>
                      <option value="unknown">Revisar</option>
                    </select>
                  </label>
                ))
              ) : (
                <small>Nenhum participante identificado.</small>
              )}
            </div>
            {role !== "employee" && (
              <form
                className="brief-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api(`/projects/${selected.id}/brief`, {
                      method: "POST",
                      body: JSON.stringify({
                        expectedRevision: selected.revision,
                        ...briefDraft,
                      }),
                    });
                    await loadWorkspace(selected.id);
                    report("Nova versão do briefing salva.");
                  });
                }}
              >
                <h3>Briefing do projeto</h3>
                <div className="form-grid">
                  {(
                    [
                      "objective",
                      "offer",
                      "audience",
                      "channel",
                      "restrictions",
                    ] as const
                  ).map((field) => (
                    <label key={field}>
                      {
                        {
                          objective: "Objetivo",
                          offer: "Oferta",
                          audience: "Público",
                          channel: "Canal",
                          restrictions: "Restrições",
                        }[field]
                      }
                      <input
                        value={briefDraft[field]}
                        onChange={(event) =>
                          setBriefDraft({
                            ...briefDraft,
                            [field]: event.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <button disabled={busy}>Salvar nova versão</button>
              </form>
            )}
          </div>

          <div className="panel messages-panel">
            <div className="section-title">
              <div>
                <h3>Histórico recente da conversa</h3>
                <p>
                  Consulta das mensagens sincronizadas. A análise de novas
                  mensagens acontece automaticamente.
                </p>
              </div>
              <span>
                {messages.length === 100
                  ? "Últimas 100 mensagens"
                  : `${messages.length} mensagens recentes`}
              </span>
            </div>
            {!messages.length ? (
              <p>Nenhuma mensagem sincronizada neste projeto.</p>
            ) : (
              messages.map((message) => (
                <article
                  className={`message ${message.direction}`}
                  key={message.id}
                >
                  <div>
                    <strong>{message.sender_name ?? "Participante"}</strong>
                    <small>
                      {new Date(message.sent_at).toLocaleString("pt-BR")}
                    </small>
                    <p>{message.text}</p>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="empty">
          <h3>Nenhum projeto autorizado.</h3>
          <p>
            {role === "admin"
              ? "Cadastre um cliente e crie o primeiro projeto."
              : "Peça ao administrador para incluir você em um projeto."}
          </p>
        </div>
      )}
    </section>
  );
}
