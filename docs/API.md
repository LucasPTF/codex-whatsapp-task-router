# API e contratos

## Implementado
HTTP somente 127.0.0.1, JSON <=64 KiB por padrão, token Bearer de sessão com hash persistido (8 h), validação de Host/Origin e sem CORS aberto. Importações permitem corpo JSON de até 6 MiB e texto de até 5 MiB. Demo usa credenciais fictícias; produção local exige bootstrap de administrador. Nunca expor por proxy público antes de P1-03/TLS.

| Método/rota | Permissão e comportamento |
|---|---|
| GET /api/health | Sem login; mode, conector, Codex e último tick, sem dados privados |
| POST /api/login | username/password demo; retorna token e ator; limite local de tentativas |
| POST /api/logout | Revoga token |
| GET /api/whatsapp/pairing | Gestor/admin consulta estado de vínculo; QR nunca aparece na saúde pública |
| GET /api/whatsapp/groups | Gestor/admin lista grupos coletados, classificação e vínculo |
| POST /api/whatsapp/groups/map | Cadastra manualmente um grupo pendente como cliente/projeto |
| POST /api/whatsapp/groups/ignore | Marca grupo como não cliente, desativa derivados e preserva dados brutos |
| POST /api/whatsapp/groups/restore | Retira grupo da lista de bloqueio, reativa derivados e reconcilia mensagens |
| GET/POST /api/admin/users | Administrador lista/cria contas sem expor hash de senha |
| POST /api/admin/users/:id/deactivate | Administrador desativa conta e revoga sessões; não permite autodesativação |
| POST /api/admin/users/:id/password | Administrador troca senha e revoga sessões existentes |
| GET /api/admin/projects | Administrador lista projetos existentes e membros |
| POST /api/admin/projects/:id/members | Administrador adiciona/remove membro; define também o escopo de gestores |
| GET/POST /api/clients | Lista clientes autorizados; administrador cadastra cliente |
| POST /api/clients/:id | Administrador atualiza nome/estado do cliente |
| GET/POST /api/projects | Lista projetos autorizados; administrador cria projeto, briefing e membros |
| GET/POST /api/projects/:id | Consulta ou atualiza projeto com revisão otimista |
| POST /api/projects/:id/brief | Gestor/admin cria nova versão do briefing |
| POST /api/projects/:id/import-preview | Valida e resume exportação `.txt` do WhatsApp sem persistir |
| POST /api/projects/:id/import-whatsapp | Importa arquivo confirmado sem criar tarefas retroativas |
| GET /api/projects/:id/messages | Histórico importado, limite de 1 a 500 |
| POST /api/projects/:id/participants/:id | Gestor/admin corrige participante como cliente/equipe/revisar |
| POST /api/projects/:id/analysis-runs | Gestor/admin inicia análise Codex do snapshot atual; retorna 202 |
| GET /api/projects/:id/analysis-runs/latest | Última execução e propostas do projeto autorizado |
| GET /api/analysis-runs/:id | Consulta execução autorizada para polling |
| POST /api/analysis-runs/:id/cancel | Gestor/admin cancela execução em andamento |
| POST /api/analysis-proposals/:id/approve | Revalida revisão/evidências, cria ou mescla tarefa e encaminha |
| POST /api/analysis-proposals/:id/reject | Descarta proposta sem criar tarefa |
| POST /api/tasks/manual | Gestor/admin cria tarefa com evidência e roteamento determinístico |
| GET /api/tasks | Funcionário: atribuídas a si; gestor: todas demo |
| GET /api/tasks/:id | Tarefa e evidências; autorização |
| POST /api/tasks/:id/transition | `{version,status,note}`; assume/bloqueia/conclui/cancela |
| POST /api/tasks/:id/assign | Gestor; `{version,employeeId}`; valida capacidade e membro do projeto |
| GET /api/tasks/:id/document | DOCX do briefing com evidências; autorização |
| GET /api/notifications | Apenas destinatário autenticado |
| POST /api/notifications/:id/read | Marca visualização, não assume tarefa |
| POST /api/demo/scenario | Somente modo demo e gestor; injeta fixture e análise simulada identificada |

Erros: 400 contrato/dados; 401 autenticação; 403 autorização/origem; 404 inexistente; 409 conflito de versão/transição; 413 tamanho; 415 tipo; 429 limite; 500 falha genérica sem vazamento de detalhes.
Não existe endpoint de envio WhatsApp. Download não altera tarefa para concluída.

## Planejado por incremento
- Projects/clients/members: telas de edição/desativação e manutenção completa de membros.
- Messages/imports/coverage: formatos adicionais, paginação, cobertura e mapeamento de identidade externa.
- Tasks: edição versionada, dependências, reabertura, prazos e reatribuição com motivo.
- Notifications/events: SSE com cursor e replay, ack de entrega por dispositivo, leitura por usuário.
- Skills/runs: avaliações, fila/lease e observabilidade adicionais; as rotas já não aceitam paths/executáveis do cliente.
- Artifacts/approvals: versões imutáveis, downloads autorizados e revisão vinculada a hash/snapshot.
- Connector/admin: vincular/desvincular conta, estado, capacidades e falhas; segredo só central.
- Operations: backup, diagnósticos redigidos e políticas.
Cada rota mutável precisa autorização de domínio, contrato e auditoria, além de idempotência quando criação puder ser repetida. Validação de versão retorna conflito, nunca sobrescrita silenciosa.
