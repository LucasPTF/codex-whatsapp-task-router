# Topologia e implantação

## Destino
Um computador central Windows autorizado mantém SQLite, arquivos canônicos, sessão do conector, fila, agendador e executor Codex. Cada funcionário tem cliente Electron. React pode ser servido pelo mesmo backend, mas o desktop habilita toast, bandeja e exportação controlada.
Rede inicial LAN autenticada e protegida por TLS. Endereço do servidor configurável; firewall restrito à rede necessária. Não compartilhar SQLite. SQLite admite múltiplos leitores mas serializa escrita; transações curtas e um proprietário de persistência reduzem disputa.
Acesso remoto somente depois: canal privado autenticado e revisão de segurança. Não abrir porta pública como atalho.

## Processos
- Cliente desktop: interface, bandeja, reconexão e notificações locais.
- Backend: autenticação, autorização, API, persistência, scheduler, roteamento e entrega de eventos.
- Worker de anexos: OCR/transcrição/conversão com limites e isolamento.
- Worker de IA: Codex CLI com contexto preparado, timeout/cancelamento e acesso restrito.
- Conector: processo supervisionado; reinício sem derrubar API.
Na base, API/SQLite/scheduler estão no mesmo processo e conector/worker reais ainda não estão ligados. Bom para protótipo; trabalho pesado deve sair do processo antes da integração.

## Continuidade Windows
Fechar janela != sair do app != encerrar serviço. O MVP de desktop pode iniciar no login e permanecer na bandeja. Operação antes do login precisa de serviço Windows supervisionado e tratamento específico das credenciais e sessão. Não executar como SYSTEM por conveniência.
Um watchdog reinicia processos com espera progressiva, limite de tentativas e estado de falha. Watchdog local não resolve energia ou travamento integral. Máquina desligada não recebe mensagens; ao retornar reconciliar o que o conector disponibiliza e marcar lacunas restantes.

## Ambientes
- Demo: dados fictícios, loopback, fixture, credenciais conhecidas, sem integrações reais (entrega atual).
- Desenvolvimento: testes isolados, fixtures anonimizadas, nunca apontar testes a banco real.
- Piloto: pessoas/projetos limitados, integração aprovada, backups e fallback manual.
- Produção: gates concluídos; sem seed demo; segredos protegidos; release rastreável.

## Portabilidade
Usar path APIs, nomes seguros e IDs; sem nomes de clientes como chave de diretório. Separar notificações, cofre, autostart e exportação por plataforma. Backend Node 24 é independente do runtime embutido no Electron. Mac só após aprovação Windows; requer máquina real, Keychain, empacotamento/assinatura/notarização e revisão dos custos.
