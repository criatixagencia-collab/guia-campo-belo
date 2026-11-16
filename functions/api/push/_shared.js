const encoder = new TextEncoder();

export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

export function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}

export async function readJson(request, maxBytes = 4096) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > maxBytes) return null;
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function endpointId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(endpoint));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === 'fcm.googleapis.com'
      || host === 'updates.push.services.mozilla.com'
      || host.endsWith('.push.apple.com');
  } catch { return false; }
}

export async function adminAuthorized(request, env) {
  const expected = env.PUSH_ADMIN_TOKEN;
  const supplied = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied || expected.length < 32) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(supplied))
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function hasDatabase(env) {
  return Boolean(env.PUSH_DB && typeof env.PUSH_DB.prepare === 'function');
}
