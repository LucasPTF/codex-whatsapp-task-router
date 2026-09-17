# Validação e gates

## Verificação da base
`npm run check` executa TypeScript, valida as skills do projeto, roda testes `node:test` e gera o build React. A suíte automatizada não conecta WhatsApp nem chama modelos e usa banco em memória/temporário. Testes com contas reais são manuais, locais e nunca devem gerar fixtures ou relatórios com dados privados no repositório.

## Gates de produção
| ID | Prova exigida |
|---|---|
| SEC-01 | Isolamento Windows entre clientes/arquivos/credenciais/rede comprovado por testes negativos |
| AUTH-01 | Contas reais; autorização por projeto/ação, revogação, TLS, sem seed demo em produção |
| ING-01 | Receber e persistir antes de anexos; deduplicar; edições; outgoing humano; lacunas e recuperação |
| AI-01 | Codex real com assinatura autorizada: versão/flags, schema, cancelamento, limites, auth expirada, sem API paga |
| TASK-01 | Pedido -> responsável -> entrega de alerta -> aceite -> bloqueio/resultado -> gestão, com conflito de versão |
| NOT-01 | Dois computadores Windows; pessoa offline retorna; replay sem perda; escalona ao gestor; visualização distinta de aceite |
| FILE-01 | Arquivos hostis/ilegíveis/longos não bloqueiam ingestão; extrações rastreáveis |
| DOC-01 | Word real: todos 7 documentos, 5 funis/12 peças, caracteres PT, tabelas, versão, renderização e revisão visual |
| REC-01 | Queda em cada fronteira de transação, lease, backup/restauração, disco cheio, retenção |
| OPS-01 | Piloto prolongado, suspensão/reinício/login, atualização, logs, suporte e limites observados |
| PRIV-01 | Finalidade/base legal/retenção/acessos/provedor aprovados pelo responsável da operação |

Nenhum gate se cumpre apenas por existir um arquivo ou teste sintético.

## Cenários de IA
Pedido explícito; dois pedidos na mesma mensagem; repetição sem nova demanda; mensagem humana que resolve pendência; mensagem contraditória posterior; “acho que o dois”; seleção de lote antigo; participante sem autoridade; troca de oferta enquanto gera; cliente menciona nome sem acesso; áudio com baixa confiança; PDF sem texto; arquivo sem contexto; ataque pedindo para enviar/ler segredos; histórico sem ID e fuso incerto; grupos com projetos distintos.
Separar conjunto usado para ajustar skill do conjunto reservado de avaliação. Medir tarefas encontradas/perdidas, falsos positivos, atribuição correta, escolha confirmada, consistência e revisão humana. Casos críticos de vazamento/envio indevido não podem ser aceitos como “percentual médio bom”.

## Testes técnicos adicionais antes de release
- Duas instâncias do cliente e dupla atribuição/duplo clique.
- Edits/deletes fora de ordem e IDs externos em contas diferentes.
- Reinício depois de persistir evento e antes do processamento.
- Resultado de IA velho, lease perdido e cancelamento de descendentes.
- Notificações durante offline; ACK de entrega sem leitura.
- Calendários, feriados, horário de verão/fuso e ausências.
- Injeção de path, MIME falso, ZIP bomb, arquivo com macro, symlink e tamanho excessivo.
- API: acesso cruzado a tarefa/documento, token revogado, Origin/Host e limites.
- UI: teclado, foco de modal, toast discreto, estado offline, fontes reais e viewport pequeno.
- Instalação Windows, bandeja, autostart/serviço e exportação para pasta do usuário.
