# Modelo de dados

## Convenções
UUIDs internos; IDs externos separados e escopados por conector/conta/conversa. UTC ISO normalizado; fuso IANA configurado por organização/pessoa. Chaves estrangeiras habilitadas. Retenção e exclusão não podem apagar silenciosamente evidências ainda necessárias. Índices por projeto, responsável/status, relógios de escalonamento e jobs disponíveis. Metadados no SQLite, binários no armazenamento local central.
Migrações numeradas, checksum, transacionais quando possível, backup antes de alteração destrutiva e plano de restauração compatível. Não editar migração aplicada.

## Modelo lógico final (nem todas as tabelas estão implementadas)
| Domínio | Entidades e campos centrais |
|---|---|
| Identidade | employees, users, sessions, roles, employee_capabilities; ativo, hash de senha, expiração/revogação |
| Acesso | project_members, role_permissions; projeto e ação permitida |
| Negócio | clients, projects, project_conversations, project_briefs; versão, objetivo, oferta, restrições |
| Conversas | connector_accounts, conversations, participants, participant_roles; identidade externa e aprovadores |
| Captura | inbound_events, messages, message_revisions, sync_checkpoints, coverage_gaps, import_batches |
| Anexos | attachments, attachment_jobs, extracted_segments; hash, MIME real, tamanho, status, transcrição/OCR e confiança de extração |
| Contexto | conversation_summaries, confirmed_facts, fact_evidence; versão, intervalo coberto, conflitos, superseded_by |
| Tarefas | tasks, task_evidence, task_dependencies, task_assignments; tipo, aceite, prazo, bloqueio, resultado, optimistic version |
| Pessoas | routing_rules, work_calendars, absences, substitutes, escalation_rules |
| Execução | jobs, job_attempts, events/outbox, consumer_checkpoints, scheduler_state |
| Notificações | notifications, notification_deliveries; usuário, tarefa, etapa, entrega, visualização, dispositivo |
| Funis | funnel_option_sets, funnel_options, funnel_selections; briefing/snapshot, versão, evidência e confirmação |
| Produção | production_runs, production_steps, artifact_dependencies |
| Skills | skill_definitions, skill_versions, skill_permissions, skill_runs, skill_evaluations |
| Arquivos | artifacts, artifact_versions, artifact_exports; hash, paths relativos, MIME, tamanho, versão/template |
| Revisão | approvals, approval_revocations; aprovador, hash e versões exatas, motivo |
| Operação | settings, audit_logs, backup_runs, diagnostics |

## O que existe na migração 001
employees, capabilities, projects, project_members, messages, tasks, task_evidence, notifications, events, audit_logs, jobs e migrations. Modelo mínimo para fluxo fictício. DDL final deve ser adicionado por incrementos, não uma tabela gigante genérica JSON.

## Incrementos implementados
- Migração 002: sessões persistentes com hash, expiração e revogação.
- Migração 003: clients, atributos de projects, project_briefs, conversations, participants e import_batches. Mensagens importadas continuam na tabela canônica `messages` e tarefas apontam para elas por `task_evidence`.
- Migração 004: analysis_runs e analysis_proposals, com snapshot/revisão, hashes, cobertura, estado/erro e decisão humana ligada à tarefa criada ou mesclada.

## Concorrência e deduplicação
- Mensagem: chave externa composta. Mesma chave com conteúdo diferente é edição/conflito, não duplicata a descartar.
- Tarefa: chave de intenção por projeto enquanto ativa. Similaridade da IA só sugere mesclar; não garante identidade. Conservar múltiplos pedidos distintos da mesma mensagem.
- Job: chave de tipo/projeto/snapshot/skill; mesma tentativa não repete efeitos.
- Evento: id persistente e checkpoint do consumidor; replay idempotente.
- Notificação: tarefa/destinatário/estágio/versão; reconexão não gera toast infinito.
- Alteração de tarefa exige `expectedVersion`; conflito retorna 409 e força releitura.
- Worker usa lease, heartbeat e token; resultado de executor que perdeu lease é rejeitado.

## Versionamento
Snapshot de análise contém projectRevision, briefingVersion, messageRevisionSet, summaryVersion, skillHash, schemaVersion e modelo/CLI. Produção acrescenta funnelSelectionVersion. Guardar entrada permitida, output validado, erro categorizado e metadados de execução conforme retenção. Não gravar segredos ou prompt bruto indiscriminadamente em logs.
Resultados semânticos não viram fatos confirmados automaticamente. Evidências citadas devem existir e pertencer ao projeto. Resumo é derivado, não autoridade.

## Armazenamento de documentos
`data/projects/<projectId>/artifacts/<artifactId>/<version>/document.docx` com nome amigável apenas na exportação. Escrita temporária + rename atômico no mesmo volume; hash verificado; reconciliador elimina órfãos e sinaliza metadados sem bytes. Backup inclui manifesto banco/arquivos.
Exportação ao funcionário registra versão/hash e destino local somente quando aplicável. Abrir pasta aceita caminho previamente exportado pela aplicação; não recebe caminho arbitrário da IA ou renderer.
