# WhatsApp: entrada de dados somente

## Fronteira

O conector expõe conexão/status, eventos, download de anexos e cobertura. Não expõe send, react, delete, group mutations ou marcação intencional de leitura. Isso limita ações do workflow; sincronização ainda pode produzir tráfego de protocolo. Ler por biblioteca não oficial continua com risco não quantificado de restrição da conta.

## Decisão do conector

O usuário escolheu o conector gratuito Baileys para grupos e conversas individuais da conta vinculada. O risco de integração não oficial continua explícito; a extensão efetivamente entregue pelo history sync será medida no primeiro vínculo.
API oficial: capacidades, configuração, webhook, custos e elegibilidade variam. Grupos API não devem ser presumidos compatíveis com grupos existentes. Coexistência pode ter recursos próprios de histórico. Verificar documentação da Meta e conta real na implantação; não fixar limites de participantes, número novo obrigatório ou elegibilidade a partir de conversas anteriores.
Não oficial: a implementação usa Baileys 7.0.0-rc14 por WebSocket, sem navegador. O QR fica em rota autenticada de gestão e a credencial permanece fora do Git. Não há garantia de menor risco de bloqueio ou de histórico integral; não usar técnicas de “parecer humano” como requisito de segurança.
Importação manual: alternativa inicial para avaliar inteligência sem conectar conta. Deve ter prévia, participantes, projeto, datas/fuso, hash e cobertura. Duplicação por exportação sem IDs reais exige sinalização; hash de texto não distingue eventos iguais legítimos.

## Eventos

Incoming/outgoing humano, mensagem editada, removida, reação relevante, participantes alterados, sessão desconectada/reconectada, anexo indisponível e tipos não suportados. Conector informa capability flags. Não presumir que mensagem “outgoing” identifica qual funcionário digitou; quando provedor não oferece autoria, manter desconhecida.
Grupos precisam de participantes e aprovadores por projeto. Número secundário observa apenas grupos/conversas de que participa; não lê privados do número principal e não garante histórico anterior.

## Histórico e cobertura

Persistir capturedFrom, syncedThrough quando comprovável, lastEventAt, lastConnectionCheckAt, checkpoint e gaps com motivos. Exibir histórico parcial e anexos ainda não processados. Retorno após suspensão deve reconciliar quando possível, sem declarar sucesso total se provedor não permite recuperar. Importações não geram alertas antigos até seleção explícita de período operacional.
Não extrapolar “não recebi mensagem” para “cliente não pediu nada”. UI distingue silêncio do cliente de indisponibilidade de captura.

## Janela de sincronização acordada

- Na primeira execução, consultar um mês-calendário para trás. Exemplo: em 15/09/2026 às 16h, iniciar em 15/08/2026 às 16h.
- Depois de uma execução concluída, persistir o horário até o qual o provedor foi consultado, inclusive quando nenhuma mensagem nova foi encontrada.
- Executar novamente cinco horas depois. Cada consulta incremental começa quinze minutos antes do checkpoint e termina no horário da nova execução.
- A sobreposição é intencional. A chave externa da mensagem elimina repetições; somente mensagens realmente inseridas entram na próxima análise.
- Nunca usar o indicador lida/não lida do WhatsApp como checkpoint.
- Uma execução parcial ou com erro não avança o checkpoint. A próxima tentativa cobre novamente a faixa pendente.
- Eventos recebidos ao vivo são gravados imediatamente com `sync_run_id` vazio. A próxima coleta dentro da janela os associa ao run, atualiza o espelho em arquivos e os encaminha à análise; assim, reinício não perde uma mensagem já recebida.

## Espelho local por cliente

O banco SQLite permanece a fonte oficial. Para conferência e backup, cada projeto mapeado também possui uma pasta em `var/conversas-clientes`, nomeada pelo cliente e por um identificador curto. `conversa.txt` é legível; `mensagens.jsonl` preserva campos estruturados; `informacoes.json` registra grupo, projeto, contagem e horário da exportação. Os arquivos são reconstruídos, não editados manualmente.

## Cadastro automático de clientes

- Somente grupos entram nessa etapa; conversas individuais permanecem na caixa bruta.
- O título literal vira o nome do cliente e do projeto, preservando numeração e demais caracteres.
- São indícios automáticos: prefixo numérico; códigos `L.2`/`L2` ou `T` seguido de número; mês da compra em formas como `[T JUL]`, `[ABR]`, `(T OUT)`, `TJULHO` ou `L.2 Setembro`; e `[TM]` com marca operacional.
- A varredura ocorre ao iniciar o servidor e depois de cada sincronização concluída. Portanto, um grupo novo aparece quando a primeira mensagem dele for coletada, não no instante vazio da criação.
- O histórico é ligado ao projeto, mas não cria demandas retroativas. Mensagens futuras continuam no mesmo projeto.
- “Não é cliente” move o grupo para a lista persistente “Não analisar”, desativa cliente/projeto derivados, interrompe o espelho futuro e conserva a caixa bruta para auditoria.
- “Retirar da lista” restaura o estado anterior. Se o grupo já tinha projeto, ele é reativado e recebe as mensagens coletadas durante o bloqueio; se ainda estava em revisão, volta para essa fila.

## Falha e recuperação

Desconexão interrompe certeza de cobertura e notifica administrador. Reconectar automaticamente somente em falhas recuperáveis; QR/reautenticação exigem fluxo visível do responsável. Não repetir login em loop. Revogação de sessão deve invalidar segredos locais associados. Sessões criptografadas e fora de logs/Git/artefatos. Monitor externo futuro detecta ausência do computador, sem garantir causa.
