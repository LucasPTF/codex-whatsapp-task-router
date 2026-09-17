import React, { useCallback, useEffect, useRef, useState } from "react";

type Api = (path: string, options?: RequestInit) => Promise<Response>;
type AnalyzerStatus = { state: string; model: string | null };
type Proposal = {
  id: string;
  title: string;
  description: string;
  kind: string;
  priority: string;
  due_at: string | null;
  evidenceIds: string[];
  needs_review: number;
  status: "pending" | "approved" | "rejected";
  task_id: string | null;
};
type AnalysisRun = {
  id: string;
  status: "running" | "succeeded" | "failed" | "stale" | "cancelled";
  summary: string | null;
  error_code: string | null;
  model: string;
  total_message_count: number;
  included_message_count: number;
  proposals: Proposal[];
};

const kindLabels: Record<string, string> = {
  copy: "Copy",
  design: "Design",
  page: "Página",
  strategy: "Estratégia",
  service: "Atendimento",
};
const priorityLabels: Record<string, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export function AnalysisPanel({
  projectId,
  analyzerStatus,
  api,
  onTaskCreated,
  report,
}: {
  projectId: string;
  analyzerStatus: AnalyzerStatus;
  api: Api;
  onTaskCreated: () => Promise<void>;
  report: (message: string, error?: boolean) => void;
}) {
  const [analysis, setAnalysis] = useState<AnalysisRun | null>(null);
  const [busy, setBusy] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;

  const load = useCallback(
    async (runId?: string) => {
      const path = runId
        ? `/analysis-runs/${runId}`
        : `/projects/${projectId}/analysis-runs/latest`;
      const response = await apiRef.current(path);
      setAnalysis(await response.json());
    },
    [projectId],
  );

  useEffect(() => {
    setAnalysis(null);
    void load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (analysis?.status !== "running") return;
    const timer = setInterval(
      () => void load(analysis.id).catch(() => {}),
      2000,
    );
    return () => clearInterval(timer);
  }, [analysis?.id, analysis?.status, load]);

  async function act(action: () => Promise<void>) {
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

  const unavailable = analyzerStatus.state !== "ready";
  return (
    <section className="panel analysis-panel">
      <div className="section-title">
        <div>
          <h3>Analisador de demandas</h3>
          <p>
            O Codex lê o snapshot e devolve sugestões. Você aprova antes de
            criar e notificar.
          </p>
        </div>
        <span className={unavailable ? "analysis-off" : "analysis-ready"}>
          {unavailable ? "Desativado" : "Codex conectado"}
        </span>
      </div>
      <p className="privacy-note">
        Ao iniciar, as mensagens exibidas na cobertura são enviadas à OpenAI
        usando a conta autenticada no Codex deste computador. O analisador não
        recebe ferramentas de terminal, arquivos, navegador ou envio.
      </p>
      {unavailable ? (
        <p>
          {analyzerStatus.state === "missing_executable"
            ? "O executável do Codex não foi encontrado."
            : analyzerStatus.state === "missing_auth"
              ? "Entre no Codex com sua conta ChatGPT neste computador."
              : analyzerStatus.state === "invalid_assets"
                ? "A skill ou o schema não passou na verificação de integridade."
                : "Ative CODEX_ANALYZER_ENABLED=true ao iniciar o servidor."}
        </p>
      ) : (
        <div className="actions">
          <button
            type="button"
            disabled={busy || analysis?.status === "running"}
            onClick={() =>
              void act(async () => {
                const response = await api(
                  `/projects/${projectId}/analysis-runs`,
                  { method: "POST", body: "{}" },
                );
                setAnalysis(await response.json());
                report(
                  "Análise iniciada. Você pode continuar usando o painel.",
                );
              })
            }
          >
            {analysis ? "Analisar novamente" : "Analisar conversa com Codex"}
          </button>
          {analysis?.status === "running" && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api(`/analysis-runs/${analysis.id}/cancel`, {
                    method: "POST",
                    body: "{}",
                  });
                  await load(analysis.id);
                  report("Análise cancelada.");
                })
              }
            >
              Cancelar análise
            </button>
          )}
        </div>
      )}
      {analysis && (
        <div className="analysis-result" aria-live="polite">
          <div className="analysis-meta">
            <strong>
              {analysis.status === "running"
                ? "Analisando…"
                : analysis.status === "succeeded"
                  ? "Análise concluída"
                  : analysis.status === "stale"
                    ? "Análise desatualizada"
                    : analysis.status === "cancelled"
                      ? "Análise cancelada"
                      : "A análise falhou"}
            </strong>
            <span>
              Cobertura: {analysis.included_message_count} de{" "}
              {analysis.total_message_count} mensagens · {analysis.model}
            </span>
          </div>
          {analysis.error_code && (
            <p className="error">{analysis.error_code}</p>
          )}
          {analysis.summary && <p>{analysis.summary}</p>}
          {analysis.status === "succeeded" && !analysis.proposals.length && (
            <p>Nenhuma nova demanda foi sugerida para este snapshot.</p>
          )}
          {analysis.proposals.map((proposal) => (
            <article
              className={`proposal ${proposal.status}`}
              key={proposal.id}
            >
              <div className="proposal-heading">
                <h4>{proposal.title}</h4>
                <span>
                  {proposal.status === "pending"
                    ? "Aguardando revisão"
                    : proposal.status === "approved"
                      ? "Aprovada"
                      : "Descartada"}
                </span>
              </div>
              <p>{proposal.description}</p>
              <small>
                {kindLabels[proposal.kind] ?? proposal.kind} ·{" "}
                {priorityLabels[proposal.priority] ?? proposal.priority} ·{" "}
                {proposal.evidenceIds.length} evidência(s)
                {proposal.needs_review ? " · Codex sinalizou dúvida" : ""}
              </small>
              {proposal.status === "pending" && (
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const response = await api(
                          `/analysis-proposals/${proposal.id}/approve`,
                          { method: "POST", body: "{}" },
                        );
                        const result = await response.json();
                        await Promise.all([load(analysis.id), onTaskCreated()]);
                        report(
                          result.assigneeId
                            ? "Sugestão aprovada, atribuída e notificada."
                            : "Sugestão aprovada e enviada para triagem.",
                        );
                      })
                    }
                  >
                    Aprovar e encaminhar
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api(`/analysis-proposals/${proposal.id}/reject`, {
                          method: "POST",
                          body: "{}",
                        });
                        await load(analysis.id);
                        report("Sugestão descartada.");
                      })
                    }
                  >
                    Descartar
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
