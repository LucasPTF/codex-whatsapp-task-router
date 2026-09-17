# Produto e processo

## Atores
- Administrador: configuração, contas, integrações, skills homologadas e recuperação.
- Gestor: triagem, atribuição, prazos, revisão e escalonamento dos projetos autorizados.
- Funcionário: suas tarefas e projetos, skill permitida, aceite, bloqueio, entrega e download.
- Aprovador do cliente: participante autorizado a confirmar briefing/funil; evidência vem da conversa ou registro manual.
- Cliente externo: não acessa esta aplicação inicialmente.

Matriz demonstrativa: gestão com acesso global; conteúdo na triagem, copy, funil e atendimento; web em sites; mídia em tráfego pago e pixel. O banco roteia por capacidades e os perfis devem ser substituídos em cada implantação.

## Fluxo principal
Pedido ou alteração -> ingestão -> contexto/evidência -> proposta da IA -> validação -> tarefa nova ou atualização proposta -> roteamento -> notificação -> aceite -> execução manual/skill -> revisão -> conclusão com resultado.

Se o responsável não for único, estiver ausente ou não tiver permissão, usar regras de substituição e triagem. IA classifica a demanda; regras escolhem pessoas. Mudança de prioridade, prazo ou responsável deve ser auditável e visível.

## Escopo de primeira versão de produção
- Ler conversas autorizadas e mensagens humanas enviadas pela equipe.
- Importar histórico com prévia, cobertura e data de início operacional.
- Textos, imagens, PDFs, DOCX, planilhas, áudios e vídeos com processamento limitado e status.
- Clientes, participantes, projetos/campanhas, briefing e responsáveis.
- Pendências por pessoa, tarefas sem aceite, bloqueios, vencimentos e escalonamento.
- Skills manuais e geração automática de rascunhos permitidos.
- Cinco funis, confirmação da escolha, copy, headlines, 12 propostas textuais de criativos, descrições visuais, roteiros e orientações da página.
- Word versionado, aprovação interna, copiar texto, baixar e abrir pasta local.
- Auditoria, diagnóstico, backup/restauração, controle de acesso.

## Não incluir agora
Envio pelo WhatsApp (nem botão de um clique), reação/marcação de leitura intencional por workflow, disparos, CRM financeiro, celular, imagens finais, hospedagem pública, geração automática de página, Mac. Eventual novo escopo requer decisão explícita.

## Telas finais
1. Entrada/configuração: servidor central, login, saúde da conexão, sem credenciais de IA no cliente.
2. Minhas tarefas: filtros por projeto/prazo/prioridade/status, evidência, aceite, bloqueio e resultado.
3. Gestão: fila de triagem, carga, atrasos, ausência/substitutos e escalonamentos.
4. Cliente/projeto: conversas relacionadas, participantes/autorizados, briefing, fatos, resumos, tarefas e artefatos.
5. Revisão: contexto/evidências, JSON transformado em campos editáveis, diferenças entre versões, aprovar/reprovar/regenerar.
6. Skills: catálogo, versão, permissões, modo manual/automático, avaliação, rollback e execuções.
7. Notificações: persistentes; entregar não é ler; ler não é assumir; abrir tarefa pelo alerta.
8. Diagnóstico: conector, lacunas, fila, executor, último tick/backup, disco, erros exportáveis sem conteúdo sensível.

## Produção
Confirmar briefing mínimo: oferta, público, objetivo, canal, provas, restrições, tom e prazo. Distinguir fatos conhecidos de hipóteses. Não inventar preço, garantia, resultado, depoimento ou condição comercial.
Gerar cinco alternativas de funil distintas e uma recomendação fundamentada. A escolha identifica `optionSetId`, versão e opção, com evidência e autoridade. Ambiguidade como “acho que o dois” entra em revisão. Mudança de escolha cria versão e invalida produção descendente.
As 12 peças são propostas de criativo em texto no Word: identificador, ângulo, público/hipótese, headline, texto, CTA, direção visual e restrições. Imagem final é trabalho posterior.
Gerar pacote: 00 Resumo; 01 Funil; 02 Copy; 03 Criativos (12); 04 Descrições; 05 Roteiros; 06 Página. Preservar relação entre peça e descrição. Entrega ao responsável pela página exige aceite; gerar o pacote não conclui a página.

## Metas a calibrar no piloto
Medir recall de demandas, falsos positivos, atribuição correta, tempo até aceite, tarefas vencidas, tempo de resolução, ruído dos alertas, cobertura de captura, carga de revisão e duração de IA. Definir metas numéricas após baseline com conversas representativas; não inventar SLA universal.
