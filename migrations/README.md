# Banco de inscrições de notificações

Os esquemas estão em `0001_push_subscriptions.sql` e `0002_push_rate_limit.sql`. O banco de prévia e o banco de produção são separados, com binding `PUSH_DB` em cada ambiente. A primeira tabela guarda endpoint e chaves técnicas da inscrição; a segunda guarda contadores temporários com identificadores derivados do IP para limitar tentativas de inscrição. Os identificadores expirados são removidos oportunisticamente, sem prazo máximo garantido de limpeza.

O projeto fixa a compatibilidade do runtime em `wrangler.toml`. As chaves VAPID e o token do painel são segredos de runtime e não devem ser gravados no repositório:

- `PUSH_VAPID_PUBLIC_KEY` — variável pública usada pelo app para solicitar a inscrição.
- `PUSH_VAPID_PRIVATE_KEY` — segredo usado somente pelo servidor para assinar os envios.
- `PUSH_VAPID_SUBJECT` — contato VAPID, por exemplo `mailto:criatix.agencia@gmail.com`.
- `PUSH_ADMIN_TOKEN` — segredo aleatório longo para proteger o painel de envio.

Os dois bancos e suas tabelas foram preparados separadamente. O banco de produção está declarado no arquivo de configuração, mas só será associado ao ambiente principal quando essa configuração for implantada nele. Antes do lançamento, gere chaves VAPID e token administrativo novos exclusivamente para Production e cadastre os segredos nesse ambiente; não reutilize credenciais de prévia. A alteração de configuração exige nova implantação para entrar em vigor.
