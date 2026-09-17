# Operação e distribuição

## Windows primeiro
Node 24 LTS no host central; Electron em cada cliente. Instaladores separados por função (servidor/cliente ou opções explícitas). Incluir verificação de runtime, disco, diretório de dados com ACL, portas/firewall e integridade do pacote. Codex CLI instalado/autenticado pelo mecanismo oficial. Não exigir Node no computador do funcionário quando o cliente estiver devidamente empacotado.
Assinatura de executável/certificados, máquina ligada, energia, armazenamento, suporte e eventual serviço de relay podem ter custo; “quase zero de software adicional” não é custo operacional zero.

## Relógios
- Captura: contínua enquanto host/conector estiverem disponíveis.
- Debounce de análise: configurável por conversa e teto de espera.
- Prazos/aceite: scheduler frequente com relógio de calendário de trabalho.
- Auditoria de contexto: a cada 5 horas e retomada após indisponibilidade.
- Limpeza: diária configurável com dry-run, retenção e dependências.
- Backup: diário configurável e antes de migrações; retenção por gerações.
No reinício, usar timestamps/checkpoints duráveis, não depender de setInterval anterior. Drift do relógio deve ser detectável; usar UTC para comparação e biblioteca/função de calendário testada para feriados/fuso.

## Observabilidade
Saúde de UI/API/conector/worker separadas; última sincronização comprovada; lacunas; usuários conectados; fila por estado/idade; jobs vencidos; duração e falhas por skill; último backup e teste de restauração; disco; versão do app/CLI/skill/template. Quota: mostrar indisponibilidade/capacidade observada, não porcentagens inventadas. Logs JSON com correlationId/runId, rotação e sem mensagens completas/tokens. Exportação diagnóstico sanitizada.
Métricas de negócio: tempo até aceite, tempo até entrega, atrasos, triagem sem responsável, bloqueios, distribuição por pessoa, correções da IA, precisão/recall, cobertura de conversas e tempo sem monitoramento.

## Backup e restauração
Usar SQLite Backup API ou método consistente suportado pelo driver. Não copiar só `.sqlite` enquanto WAL ativo. Snapshot consistente com manifesto dos arquivos/hash/versões. Cifrar destino e separar cópia do disco principal. Definir RPO/RTO com gestor, sem inventar garantia. Testar restauração numa pasta/instância isolada, verificar migrações, contagens, referências e hashes. Recuperação de credenciais usa fluxo oficial; não depender de segredo cifrado para outro usuário/host sem plano de recuperação.

## Atualizações
Fixar lockfile, verificar integridade/origem e auditoria de dependências. Primeiro release pode usar atualização manual assinada/controlada; auto-update posterior com verificação, pausa/lease de jobs e backup pré-migração. Não fazer downgrade de app sobre schema incompatível; restaurar conjunto compatível. Rollback de skill/template não implica rollback de banco.

## Runbooks
Conector caiu: registrar gap, alertar administrador, preservar fila, tentar reconexão recuperável, solicitar vínculo quando necessário.
Codex limitado: WAITING_CAPACITY, preservar trabalho, manter manual, retomar conforme capacidade confirmada; nunca girar contas para contornar limite.
Disco cheio: parar novos downloads/geração, não descartar mensagens silenciosamente, sinalizar persistência comprometida e intervenção.
Worker travou: encerrar árvore, expirar/reivindicar lease, ignorar resultado tardio, teto de tentativas.
Servidor desligado: clientes mostram offline; novas confirmações não são presumidas salvas. Ao voltar, sincronizar e consolidar alertas atrasados.
Falha de versão: retornar conflito, recarregar e revisar antes de tentar novamente.
Não incluir e-mail/Telegram automático sem canal configurado e autorização; monitor externo tem backlog próprio.
