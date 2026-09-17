# Fluxos, estados e confiabilidade

## Ingestão
Persistir evento mínimo antes de download/transcrição; registrar jobs na mesma transação. Em webhook oficial, validar autenticidade e confirmar após persistência durável. Normalizar identidades/direção; preservar edições, exclusões e eventos não suportados quando disponíveis. Gerar hash dos anexos e nunca bloquear captura por arquivo quebrado. Ao extrair anexo novo, incrementar revisão e reavaliar análise que dependia dele.
Agrupar mensagens próximas por conversa (configuração inicial de teste: 20–60 s com limite máximo de espera). Não esperar esse intervalo para exibir mensagem recebida. Sinais de urgência podem gerar atenção preliminar; semanticamente confirmar contexto antes de atribuição definitiva.

## Análise
Construir snapshot: projeto, briefing, fatos/evidências, resumo coberto, mensagens novas, respostas humanas, pendências e anexos relevantes. IA retorna propostas estritas. Validar schema, referências, contexto e revisão atual. Resultado velho fica obsoleto e pode solicitar análise nova agrupada; não aplicar parcialmente sobre estado incompatível.
Auditoria completa a cada 5 h prioriza conversas alteradas e pendências. Checagem determinística de prazos/aceite roda aproximadamente a cada minuto, inclusive sem novas mensagens. Computador dormiu: recuperar último checkpoint, consolidar atrasos e evitar enxurrada de notificações.

## Tarefas
Estados: OPEN -> IN_PROGRESS -> DONE; IN_PROGRESS -> BLOCKED -> IN_PROGRESS; cancelamento com motivo. Triagem é responsável ausente/revisão pendente, não desaparecimento da tarefa. Reabertura cria evento e versão; implementação pode criar tarefa vinculada quando for demanda nova.
Revisão humana deve confirmar alterações sensíveis de escopo, prazo ou atribuição quando houver ambiguidade. Demandas resolvidas nas respostas humanas não devem permanecer abertas automaticamente; propor conclusão e exigir confirmação nos casos sem evidência suficiente.
Estágios: criada, notificação entregue, visualizada, assumida e concluída. Conclusão exige resultado/artefato/evidência. Não concluir somente por clique de copiar ou download.

## Roteamento
Selecionar por projeto, tipo/capacidade, disponibilidade e regra configurada. Nome citado na mensagem não concede permissão. Empates, falta de pessoa e ausência sem substituto vão à triagem do gestor. Permitir override autorizado com motivo. Registrar quem atribuiu, por qual regra e versão. Configurar tempo para aceitar e prazo para entregar separadamente; SLA respeita calendário, feriados, fuso e prioridade. A base usa 30 min corridos fictícios e ainda não calendário.

## Alertas e entrega
Central persistente é autoridade. Canal de transporte pode usar SSE/WebSocket com replay por cursor; reconectar com backoff. Toast é conveniência no desktop. Se usuário estiver offline, manter pendência; ao vencer aceite, avisar substituto/gestor conforme política. Escalonamento não muda automaticamente a autoria da tarefa. Usuário pode silenciar som; não ocultar vencimento da gestão.
Lembretes agrupados e deduplicados por etapa. Heartbeat de conexão não prova entrega humana. Última mensagem recebida não prova conector saudável (a conversa pode estar silenciosa).

## Fila
Estados finais planejados: PENDING, RUNNING, SUCCEEDED, RETRY_WAIT, WAITING_CAPACITY, AUTH_REQUIRED, OBSOLETE, FAILED, CANCELLED. Cada job guarda tentativas, próxima tentativa, lease/token, timeout e snapshot. Erro transitório: backoff com jitter e teto. JSON inválido: no máximo uma correção de formato; sem liberar saída semanticamente inválida. Falha persistente: revisão. Cancelamento interrompe processo e descendentes; resultado tardio não se aplica.
Separar limites por worker: IA inicial 1 concorrente; anexos limitados por CPU/RAM; atendimento priorizado sobre lote de produção. Limite de assinatura pausa fila sem compra ou API automática. Regeneração manual é nova execução vinculada.

## Produção e aprovação
Briefing confirmado -> 5 funis -> revisão interna -> copiar/exportar -> envio humano observado/confirmado -> seleção inequívoca por aprovador -> produção -> validação cruzada -> Word -> aprovação -> tarefa da página -> aceite/entrega.
Aprovação vincula aprovador, conteúdo/hash, projeto e versões. Edição ou mudança relevante revoga aprovação de derivados. Não sobrescrever aprovado. Mudança do cliente não apaga versões anteriores. Produção parcial continua do passo válido, sem regenerar todo pacote sem necessidade.

## Outbox
Mudança de domínio e evento são gravados juntos; dispatcher cria notificação/job de forma idempotente. Reinício entre gravação e consumo permite replay. Auditoria registra ações relevantes no backend. Triggers locais ajudam contra alteração acidental, mas não tornam logs invioláveis contra administrador do computador.
