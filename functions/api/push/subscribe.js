import { endpointId, hasDatabase, json, readJson, sameOrigin, validPushEndpoint } from './_shared.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Origem inválida.' }, 403);
  if (!hasDatabase(env)) return json({ error: 'Cadastro de notificações indisponível.' }, 503);
  const subscription = await readJson(request);
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!validPushEndpoint(endpoint)
      || typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(p256dh)
      || typeof auth !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(auth)) {
    return json({ error: 'Inscrição de notificações inválida.' }, 400);
  }

  const id = await endpointId(endpoint);
  const result = await env.PUSH_DB.prepare(`
    INSERT INTO push_subscriptions (id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = unixepoch()
      WHERE push_subscriptions.endpoint = excluded.endpoint
        AND push_subscriptions.p256dh = excluded.p256dh
        AND push_subscriptions.auth = excluded.auth
  `).bind(id, endpoint, p256dh, auth).run();
  if (result.meta?.changes === 0) return json({ error: 'Inscrição incompatível. Desative e ative os avisos novamente.' }, 409);
  return json({ ok: true });
}
