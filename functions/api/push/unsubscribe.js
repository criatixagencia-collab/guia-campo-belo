import { endpointId, hasDatabase, json, readJson, sameOrigin, validPushEndpoint } from './_shared.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Origem inválida.' }, 403);
  if (!hasDatabase(env)) return json({ error: 'Cadastro de notificações indisponível.' }, 503);
  const body = await readJson(request);
  if (!validPushEndpoint(body?.endpoint)) return json({ error: 'Inscrição inválida.' }, 400);
  await env.PUSH_DB.prepare('DELETE FROM push_subscriptions WHERE id = ?')
    .bind(await endpointId(body.endpoint)).run();
  return json({ ok: true });
}
