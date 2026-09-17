# Cobertura do documento original

| Seções originais | Destino/alteração |
|---|---|
| 1–4 objetivo e escopo | PRODUTO; foco final é gestão interna multiusuário |
| 5–6 stack/topologia | TOPOLOGIA e ADRs; backend central separado dos clientes |
| 7 Codex | CODEX_E_SKILLS; limites, isolamento e auth como gates |
| 8 skills | Catálogo + .agents/skills; versões/permissões/avaliações |
| 9 WhatsApp | WHATSAPP; contrato apenas leitura, capabilities e decisão pendente |
| 10 entrada | FLUXOS/DADOS; persistir antes de processar anexos |
| 11 análise | FLUXOS; debounce, snapshot, auditoria 5h e relógio de prazos separado |
| 12 workflow | FLUXOS/DADOS; estados por dimensão, conflitos e invalidação |
| 13–14 responsáveis/tarefas | PRODUTO/FLUXOS/API; ausência, triagem, aceite e resultado |
| 15 funis | PRODUTO/CODEX_E_SKILLS; cinco, versão, evidência e autoridade |
| 16 produção | PRODUTO/BACKLOG P4; dependências e validação cruzada |
| 17 Word | DADOS/PRODUTO; sete documentos, hashes, templates e exportação local |
| 18 aprovação e envio | Aprovação interna mantida; envio integrado removido por mudança explícita do usuário |
| 19 notificações | FLUXOS/TOPOLOGIA; entregar/visualizar/assumir/concluir distintos |
| 20 banco | DADOS; tabelas implementadas separadas do modelo lógico final |
| 21–22 eventos/fila | FLUXOS e código; outbox, leases, token e recuperação |
| 23 interface/Electron | PRODUTO/SEGURANCA + UI/desktop demonstrativos |
| 24 repositório | README/AGENTS/CONTINUIDADE; monorepo e handoff |
| 25 privacidade | SEGURANCA; dados remotos, retenção real e cofre |
| 26 observabilidade | OPERACAO; cobertura e saúde separadas |
| 27 testes | TESTES + tests; gates de produção |
| 28 fases | BACKLOG; multiusuário e captura confiável antes de produção ampla |
| 29 decisões | DECISOES; perguntas na etapa bloqueante |
| 30 recomendação | ARQUITETURA/ADRs; stack mantida com limites explícitos |

## Contribuições das revisões
Incorporadas: processos separados, recuperação/sessão, papéis, prompt injection, limite Codex, limpeza e atualização, multiusuário, monitor externo opcional, identidade de projeto, persistência antecipada, outbox, versão de análise/aprovação, cobertura histórica e dados pessoais.
Corrigidas: QR não prova irregularidade; navegador não comprova menor banimento; processo filho não garante isolamento ou serviço; heartbeat local não avisa com máquina desligada; Baileys não precisa Chromium; copiar não confirma envio; API/histórico/grupos exigem documentação/conta atual; conta secundária não vê privados de outra conta.
