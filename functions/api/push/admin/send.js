import { sendNotification } from 'web-push';
import { adminAuthorized, hasDatabase, json, readJson, sameOrigin, validPushEndpoint } from '../_shared.js';

const BATCH_SIZE = 20;

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return [...value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, maxLength).join('');
}

function safeDiagnostic(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(value) ? value : null;
}

function safeDiagnosticMessage(value, env, row) {
  if (typeof value !== 'string') return null;
  let message = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  for (const secret of [env.PUSH_ADMIN_TOKEN, env.PUSH_VAPID_PRIVATE_KEY, env.PUSH_VAPID_PUBLIC_KEY,
    row.endpoint, row.p256dh, row.auth]) {
    if (typeof secret === 'string' && secret.length >= 8) message = message.split(secret).join('[redigido]');
  }
  message = message.replace(/https?:\/\/[^\s"'<>]+/gi, '[URL removida]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[dado longo removido]');
  return [...message.trim()].slice(0, 160).join('') || null;
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Origem inválida.' }, 403);
  if (!env.PUSH_ADMIN_TOKEN || !env.PUSH_VAPID_PRIVATE_KEY || !env.PUSH_VAPID_PUBLIC_KEY
      || !env.PUSH_VAPID_SUBJECT) {
    return json({ error: 'Envio de notificações ainda não configurado.' }, 503);
  }
  if (!await adminAuthorized(request, env)) return json({ error: 'Acesso não autorizado.' }, 401);
  if (!hasDatabase(env)) return json({ error: 'Banco de inscrições indisponível.' }, 503);

  const body = await readJson(request);
  const title = cleanText(body?.title, 80);
  const message = cleanText(body?.body, 240);
  const cursor = body?.cursor ?? '';
  if (!title || !message || (cursor && !/^[a-f0-9]{64}$/.test(cursor)))
    return json({ error: 'Informe título e mensagem válidos.' }, 400);

  let target;
  try {
    target = new URL(typeof body?.url === 'string' ? body.url : '/', request.url);
    if (target.origin !== new URL(request.url).origin) throw new Error('URL externa');
  } catch { return json({ error: 'O destino deve ser uma página deste app.' }, 400); }

  const { results = [] } = await env.PUSH_DB.prepare(`
    SELECT id, endpoint, p256dh, auth FROM push_subscriptions
    WHERE id > ? ORDER BY id LIMIT ${BATCH_SIZE}
  `).bind(cursor).all();
  if (!results.length) return json({ sent: 0, failed: 0, removed: 0, nextCursor: null, done: true });

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const failureDetails = [];
  await Promise.all(results.map(async row => {
    if (!validPushEndpoint(row.endpoint)) {
      await env.PUSH_DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
      removed++;
      return;
    }
    try {
      const result = await sendNotification({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth }
      }, JSON.stringify({ title, body: message, url: target.pathname + target.search + target.hash }), {
        TTL: 3600,
        urgency: 'normal',
        timeout: 8000,
        vapidDetails: {
          subject: env.PUSH_VAPID_SUBJECT,
          publicKey: env.PUSH_VAPID_PUBLIC_KEY,
          privateKey: env.PUSH_VAPID_PRIVATE_KEY
        }
      });
      if (result.statusCode >= 200 && result.statusCode < 300) sent++;
      else failed++;
    } catch (error) {
      const status = Number(error?.statusCode || error?.status || 0);
      if (status === 404 || status === 410) {
        await env.PUSH_DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
        removed++;
      } else {
        failed++;
        if (failureDetails.length < 5) {
          failureDetails.push({
            name: safeDiagnostic(error?.name),
            statusCode: status || null,
            code: safeDiagnostic(error?.code),
            message: safeDiagnosticMessage(error?.message, env, row)
          });
        }
      }
    }
  }));

  const nextCursor = results.at(-1).id;
  const more = results.length === BATCH_SIZE
    ? await env.PUSH_DB.prepare('SELECT 1 AS found FROM push_subscriptions WHERE id > ? LIMIT 1')
      .bind(nextCursor).first()
    : null;
  return json({ sent, failed, removed, failureDetails, nextCursor: more ? nextCursor : null, done: !more });
}
