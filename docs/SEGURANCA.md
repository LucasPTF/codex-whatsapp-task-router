# Segurança e privacidade

## Identidade e autorização
Produção local já exige bootstrap de administrador, usa senhas protegidas por scrypt, sessões persistidas somente por hash, expiração/revogação e proteção local de tentativas. Desativação ou troca de senha revoga sessões. Gestores só acessam projetos dos quais são membros. Ainda faltam recuperação de conta e TLS entre clientes e servidor; até P1-03 o processo permanece loopback. Token do cliente não dá acesso ao CLI, banco ou cofre. Atribuições de usuário desligado ainda dependem da futura política de substituto.
Tokens/sessões WhatsApp/Codex ficam no host central, usando mecanismo suportado/cofre do Windows; futura adaptação Keychain. Discos e backups protegidos conforme capacidade do Windows e organização. Cofre não criptografa automaticamente o SQLite ou todos os documentos.

## IA e isolamento
Mensagens/anexos são dados não confiáveis: podem conter “ignore regras”, pedidos de segredos ou instruções dentro de imagem. Não converter esse conteúdo em ferramenta, skill ou comando. Separar instruções do sistema e contexto; escopo de ferramentas reduzido e validação semântica. Schema sozinho não impede injection.
A execução habilitada exige `auth_mode=chatgpt` e recusa arquivo de autenticação com API key. Cada run recebe configuração efêmera e desabilita shell, plugins, apps, navegador, computer use, hooks, multi-agent e dependências do workspace. Eventos de ferramenta invalidam o resultado. O prompt e as mensagens não são gravados em `analysis_runs`; ficam hashes, cobertura e metadados. Propostas não viram tarefas antes de aprovação humana e resultados de revisão antiga são marcados como obsoletos.
Gate SEC-01: executar teste em Windows de tentativa de leitura do cliente B, banco, documentos de outro usuário e credenciais a partir do worker de A; todos devem falhar. Verificar também saída de rede não permitida e inexistência de ferramentas de envio. `cwd`, read-only e subprocesso não bastam. Isolamento deve ser imposto pelo OS/configuração homologada. Não deixar comando arbitrário no preload ou HTTP.

## Electron
nodeIntegration false; contextIsolation true; renderer sandbox; preload mínimo; validar remetente/frame e payload IPC. CSP; navegação/janelas externas restritas; conteúdos não confiáveis renderizados como texto; links externos abertos apenas após validação de esquema/destino. Caminhos locais e downloads escolhidos pelo app, não pela IA. Atualização assinada/verificada antes de execução. Segredos nunca em renderer ou localStorage.

## Anexos
Verificar assinatura/MIME, tamanho, páginas, resolução, duração e hash. Não executar macros; prevenir ZIP bomb, traversal e symlinks. Subprocessos com timeout, quotas de memória/disco e privilégios mínimos. OCR, PDF, áudio e vídeo em fila separada. Transcrição incerta conserva evidência e solicita revisão; não inventar conteúdo de arquivo ilegível. Planilhas não executam macros/fórmulas externas. Não seguir automaticamente URLs presentes nos arquivos.

## Dados pessoais
Inventariar finalidade, categorias e destinatários. Definir base legal com responsável pela operação, transparência e política de acesso/retenção/exclusão. Minimizar/pseudonimizar dados enviados à IA quando possível; substituir nome não garante anonimização. Conteúdo entregue ao modelo é processado remotamente. Verificar controles de dados e adequação da assinatura para uso empresarial antes do piloto.
Retenção deve alcançar banco, anexos, extrações, prompts persistidos, temporários, exports e backups. Exclusão lógica não equivale a eliminação. Regras de auditoria sem apagamento silencioso precisam conciliar eliminação legítima e retenções justificadas. Não incluir conteúdo sensível no toast por padrão.

## Backup e auditoria
Auditoria de backend registra ator, ação, entidade, versões e motivo. Não registrar senha/token ou transcrição completa por conveniência. Triggers append-only previnem alteração acidental pela aplicação; administrador local ainda pode alterar banco/código. Se necessária prova contra adulteração, especificar cópia externa ou assinatura/cadeia de hashes com chaves separadas.
Backup cifrado precisa recuperação de chave e teste de restauração. Segredos e backups não podem depender apenas do disco que está sendo protegido.
