import { adminAuthorized, hasDatabase, json, sameOrigin } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Origem inválida.' }, 403);
  if (!env.PUSH_ADMIN_TOKEN) return json({ error: 'Painel ainda não configurado.' }, 503);
  if (!await adminAuthorized(request, env)) return json({ error: 'Acesso não autorizado.' }, 401);
  if (!hasDatabase(env)) return json({ error: 'Banco de inscrições indisponível.' }, 503);
  const row = await env.PUSH_DB.prepare('SELECT COUNT(*) AS total FROM push_subscriptions').first();
  return json({ subscribers: Number(row?.total || 0) });
}
