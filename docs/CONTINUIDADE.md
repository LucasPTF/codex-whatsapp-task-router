# Continuidade e qualidade no Codex

## Fonte única por assunto
Requisito: PRODUTO/DECISOES. Implementação: código + STATUS. Trabalho futuro: BACKLOG. Resultado de teste: VALIDACAO. Contexto imediato: HANDOFF. Contrato de IA: schemas. Instrução de skill: SKILL.md. Evitar copiar decisões para vários documentos; referenciar autoridade.

## Início de sessão
1. Ler AGENTS, STATUS e HANDOFF.
2. Verificar git status/diff e último commit; preservar trabalho não relacionado.
3. Localizar o primeiro backlog acionável e ler apenas documentos relevantes.
4. Rodar verificação para estabelecer baseline quando ambiente/dependências mudaram.
5. Implementar incremento com critério observável, sem replanejar tudo.

## Antes de compactar ou encerrar
Atualizar HANDOFF: objetivo, arquivos alterados, testes/comandos/resultados, erros reais, decisões novas, limitações e próximo passo exato. Atualizar STATUS com implementado/validado/pendente. Registrar commits pequenos quando apropriado. Não declarar teste que não rodou, nem Windows validado em Linux.

## Qualidade
Cada requisito tem comportamento verificável e gate. Não aceitar “interface pronta” como integração real. Isolar fixtures; rejeitar payload malformado e acesso cruzado. Avaliação das skills usa evidência/ground truth reservado; ajustar por falhas observadas sem tornar prompt um manual infinito. ADR somente para decisão com impacto, sem burocracia para detalhes de implementação.

## Retomada após interrupção
Usar commit/diff + HANDOFF; não recriar pastas ou scaffold. Confirmar migração/checksum e lockfile. Resultado de trabalho pendente deve respeitar snapshot e lease. Se documento divergir do código, registrar a divergência antes de avançar.
