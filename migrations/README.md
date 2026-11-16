# Banco de inscrições de notificações

O esquema inicial está em `0001_push_subscriptions.sql`. No Cloudflare Pages, crie um banco D1 e associe-o ao binding `PUSH_DB` no ambiente **Preview** durante a revisão. A migração guarda apenas o endpoint e as chaves técnicas da inscrição, sem nome, e-mail ou endereço IP.

O projeto fixa a compatibilidade do runtime em `wrangler.toml`. As chaves VAPID e o token do painel são segredos de runtime e não devem ser gravados no repositório:

- `PUSH_VAPID_PUBLIC_KEY` — variável pública usada pelo app para solicitar a inscrição.
- `PUSH_VAPID_PRIVATE_KEY` — segredo usado somente pelo servidor para assinar os envios.
- `PUSH_VAPID_SUBJECT` — contato VAPID, por exemplo `mailto:criatix.agencia@gmail.com`.
- `PUSH_ADMIN_TOKEN` — segredo aleatório longo para proteger o painel de envio.

Adicione as variáveis e segredos em **Settings → Variables and secrets → Preview** e o D1 em **Settings → Bindings → Preview**. Faça uma nova implantação da branch de revisão para as alterações entrarem em vigor. Configure Production separadamente apenas após decidir lançar o app; a branch `main` e o site oficial GitHub Pages não fazem parte desta configuração.
