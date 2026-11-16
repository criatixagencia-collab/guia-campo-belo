import { json } from './_shared.js';

export async function onRequestGet({ env }) {
  if (!env.PUSH_VAPID_PUBLIC_KEY) return json({ error: 'Notificações ainda não configuradas.' }, 503);
  return json({ publicKey: env.PUSH_VAPID_PUBLIC_KEY });
}
