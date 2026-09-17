# Codex CLI e skills

## Premissas
Codex CLI é o motor solicitado; autenticação do proprietário via assinatura existente. A disponibilidade e adequação do plano ao uso central da equipe precisam ser confirmadas; não distribuir credenciais, prometer cobertura de vários usuários ou quota infinita. Sem API paga automática. Executor local usa modelo remoto; conteúdo enviado sai do computador.
A base conecta o analisador à UI sob comando e à fila automática das sincronizações incrementais. Em 2026-09-15 houve execução real do Codex CLI 0.144.6 com conversa fictícia, schema estruturado e login ChatGPT. O caso encontrou a demanda correta e a manteve pendente até aprovação humana. Isso é smoke test, não avaliação completa da skill ou do plano. `node scripts/doctor.mjs` verifica presença/versão sem consumir IA.

## Adaptador final
1. Validar autorização para skill e projeto.
2. Reservar job com lease/token e snapshot.
3. Materializar contexto mínimo em diretório exclusivo da execução.
4. Copiar schema aprovado e uma cópia efêmera da autenticação ChatGPT para um `CODEX_HOME` isolado; limpar ambos ao final.
5. Aplicar perfil de execução e isolamento homologados; impedir leitura de outros projetos e credenciais.
6. Invocar executável nativo via spawn, argumentos separados, sem shell; prompt por stdin.
7. Capturar JSONL limitado para progresso; saída final separada validada por Ajv e regras do domínio.
8. Revalidar revisão/snapshot/lease antes do commit.
9. Gravar metadados e limpar temporários conforme política.

Comando conceitual, revalidar no CLI instalado:
```text
codex --ask-for-approval never exec --ephemeral --ignore-user-config --sandbox read-only --disable shell_tool --disable plugins --json --skip-git-repo-check --output-schema <schema> -o <resultado> -
```
`--json` são eventos; não confundir com a resposta final do schema. Execução efêmera não promete ausência de tratamento remoto. `read-only` não é garantia isolada: o adapter também desabilita shell, plugins, apps, navegador, computer use, hooks, multi-agent e dependências do workspace, e rejeita eventos de ferramenta. A cópia temporária de autenticação fica no diretório efêmero do run, não é persistida no banco e é removida no `finally`; queda abrupta/ACL e isolamento entre clientes ainda pertencem ao SEC-01.

## Skills incluídas
`analisar-conversa-whatsapp`, `gerar-funis`, `identificar-funil-escolhido`, `gerar-copy`, `gerar-criativos-estaticos`, `descrever-criativos`, `gerar-roteiros`, `validar-pacote-marketing`.
São skills de projeto; chamadas explicitamente pelo backend. Catálogo possui versão, hash e modo. Apenas a skill de análise está habilitada no piloto; as demais continuam desativadas. Não foi instalada skill pessoal no ChatGPT.
Montagem Word é serviço determinístico; não necessita de skill que execute código de formatação. Catalogar templates por versão separada da versão do conteúdo.

## Contratos
- conversation-analysis: propostas de tarefas, evidências, flags de revisão; não devolve autorização de execução.
- funnel-generation: cinco opções distintas e recomendação; pode retornar blocked com informações faltantes.
- funnel-selection: opção/versão/evidência/autoridade, ou needs_review/none.
- production-content: tipo de peça, seções, criativos, roteiros e alegações/fatos; blocked quando briefing insuficiente.
A validade estrutural não garante fatos. Contagens (5/12), IDs, CTA, preço, tom, provas e coerência entre peças são validados também por regras e revisão.

## Conteúdo e avaliação
Conjunto de testes anonimizado separado em desenvolvimento e avaliação. Incluir pedidos/negações, mudança de ideia, respostas humanas, sarcasmo, mensagens fora de ordem, áudio incerto e injection. Confidence declarada pelo modelo não é probabilidade calibrada; decisões sensíveis exigem evidência/autoridade, não um limiar isolado.
Skills aprovadas são imutáveis por hash, com versão de schema, avaliações, autor/aprovador, compatibilidade e rollback. Atualizar skill não altera job já enfileirado. Instalação apenas administrador; arquivos em ZIP tratados contra path traversal/symlinks e execução automática. Scripts opcionais exigem executor com permissões limitadas e teste, não só revisão textual.
