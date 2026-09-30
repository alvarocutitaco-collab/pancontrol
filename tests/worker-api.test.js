// ════════════════════════════════════════════════════════════════
// Pruebas del backend de Cloudflare (worker/index.js) corriendo en local con
// `wrangler dev` (el mismo motor que usa Cloudflare) y una base D1 temporal.
// Verifica que la API sea la misma que la del servidor Express: login, CRUD,
// aislamiento por organización, fotos, caché (ETag) e importación.
// Ejecutar con:  node tests/worker-api.test.js   (requiere `npm install`)
// ════════════════════════════════════════════════════════════════
'use strict';
const escenarioOrgScope = require('./lib/org-scope-scenario');
const arrancarWorker = require('./lib/wrangler-dev');

let BASE;

let pasadas = 0, falladas = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ✓ ' + nombre); }
  else { falladas++; console.error('  ✗ ' + nombre + (extra ? '\n    ' + extra : '')); }
}

// Petición con "tarro de cookies" (misma forma que la prueba del servidor).
async function req(method, p, { body, jar, headers } = {}) {
  const h = Object.assign({}, headers || {});
  if (body != null) h['Content-Type'] = 'application/json';
  if (jar && jar.cookie) h.Cookie = jar.cookie;
  const res = await fetch(BASE + p, { method, headers: h, body: body != null ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.getSetCookie();
  if (jar && setCookie.length) jar.cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = buf.length ? JSON.parse(buf.toString()) : null; } catch (e) { /* no-JSON */ }
  return { status: res.status, json, buf, headers: res.headers };
}

// PNG de 1×1 para probar las fotos.
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  const admin = {}, viewer = {}, anon = {};

  // ── Login y sesión ──
  let r = await req('POST', '/api/login', { body: { password: 'admin123' }, jar: admin });
  ok('login admin → rol admin', r.status === 200 && r.json.role === 'admin', JSON.stringify(r.json));
  ok('la cookie de sesión es HttpOnly', /HttpOnly/.test(r.headers.get('set-cookie') || ''));
  r = await req('POST', '/api/login', { body: { password: 'ver123' }, jar: viewer });
  ok('login viewer → rol viewer', r.status === 200 && r.json.role === 'viewer');
  r = await req('POST', '/api/login', { body: { password: 'nop' }, jar: anon });
  ok('contraseña incorrecta → 401', r.status === 401 && r.json.error === 'Contraseña incorrecta');
  r = await req('GET', '/api/session', { jar: admin });
  ok('GET /api/session con sesión → admin', r.status === 200 && r.json.role === 'admin');
  r = await req('GET', '/api/session', { jar: anon });
  ok('GET /api/session sin sesión → 401', r.status === 401);
  const [valor, firma] = admin.cookie.split('=')[1].split('.');
  const falsa = Buffer.from(JSON.stringify({ u: 'admin', r: 'admin', o: null, e: 9999999999 })).toString('base64url');
  r = await req('GET', '/api/session', { jar: { cookie: `pc_sess=${falsa}.${firma}` } });
  ok('cookie alterada (firma que no corresponde) → 401', r.status === 401 && valor !== falsa);

  // ── Aislamiento por organización: mismo escenario que el servidor Express ──
  await escenarioOrgScope({ req, ok, admin, viewer });

  // ── CRUD de un store normal ──
  r = await req('POST', '/api/store/entradas', { body: { fecha: '2026-09-30', insumo: 'Harina', cantidad: 50 }, jar: admin });
  ok('POST entradas → 201 con id', r.status === 201 && Number.isInteger(r.json.id) && r.json.insumo === 'Harina');
  const ent = r.json;
  r = await req('PUT', '/api/store/entradas/' + ent.id, { body: { ...ent, cantidad: 60 }, jar: admin });
  ok('PUT entradas → 200 actualizado', r.status === 200 && r.json.cantidad === 60 && r.json.id === ent.id);
  r = await req('GET', '/api/store/entradas', { jar: admin });
  ok('GET entradas devuelve el registro editado', r.status === 200 && r.json.some(e => e.id === ent.id && e.cantidad === 60));
  r = await req('PUT', '/api/store/entradas/' + ent.id, { body: { cantidad: 1 }, jar: viewer });
  ok('viewer no puede editar (403)', r.status === 403);
  r = await req('DELETE', '/api/store/entradas/' + ent.id, { jar: viewer });
  ok('viewer no puede borrar (403)', r.status === 403);
  r = await req('GET', '/api/store/no_existe', { jar: admin });
  ok('store desconocido → 404', r.status === 404);
  r = await req('PUT', '/api/store/entradas/999999', { body: { a: 1 }, jar: admin });
  ok('PUT de un id inexistente → 404', r.status === 404);

  // ── Caché: ETag + 304 (ahorra lecturas del plan gratis) ──
  r = await req('GET', '/api/store/entradas', { jar: admin });
  const etag = r.headers.get('etag');
  ok('GET devuelve ETag', !!etag, 'etag=' + etag);
  r = await req('GET', '/api/store/entradas', { jar: admin, headers: { 'If-None-Match': etag } });
  ok('sin cambios → 304', r.status === 304);
  r = await req('GET', '/api/store/entradas', { jar: viewer, headers: { 'If-None-Match': etag } });
  ok('el ETag de admin no sirve para viewer (200)', r.status === 200);
  await req('POST', '/api/store/catalogos', { body: { x: 1 }, jar: admin });
  r = await req('GET', '/api/store/entradas', { jar: admin, headers: { 'If-None-Match': etag } });
  ok('tras cualquier escritura → 200 con datos nuevos', r.status === 200 && r.headers.get('etag') !== etag);
  r = await req('GET', '/api/store/entradas', { jar: anon, headers: { 'If-None-Match': etag } });
  ok('sin sesión no hay 304 (primero se exige login)', r.status === 401);

  r = await req('DELETE', '/api/store/entradas/' + ent.id, { jar: admin });
  ok('DELETE entradas → 204', r.status === 204);
  r = await req('GET', '/api/store/entradas', { jar: admin });
  ok('el registro borrado ya no aparece', r.status === 200 && !r.json.some(e => e.id === ent.id));

  // ── Fotos ──
  r = await req('POST', '/api/upload', { body: { dataUrl: 'data:image/png;base64,' + PNG_1x1 }, jar: admin });
  ok('subir foto → 201 {id,url}', r.status === 201 && /^\/api\/upload\/[a-f0-9-]{36}$/.test(r.json.url), JSON.stringify(r.json));
  const foto = r.json;
  r = await req('GET', foto.url, { jar: viewer });
  ok('ver foto (viewer) → mismos bytes y tipo', r.status === 200 && r.headers.get('content-type') === 'image/png' &&
    r.buf.equals(Buffer.from(PNG_1x1, 'base64')));
  r = await req('GET', foto.url, { jar: anon });
  ok('ver foto sin sesión → 401', r.status === 401);
  r = await req('POST', '/api/upload', { body: { dataUrl: 'data:image/png;base64,' + PNG_1x1 }, jar: viewer });
  ok('viewer no puede subir fotos (403)', r.status === 403);
  r = await req('POST', '/api/upload', { body: { dataUrl: 'data:image/gif;base64,' + PNG_1x1 }, jar: admin });
  ok('formato no permitido → 400', r.status === 400);
  r = await req('POST', '/api/upload', { body: { dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(2 * 1024 * 1024) }, jar: admin });
  ok('foto demasiado grande → 413', r.status === 413);
  r = await req('DELETE', foto.url, { jar: viewer });
  ok('viewer no puede borrar fotos (403)', r.status === 403);
  r = await req('DELETE', foto.url, { jar: admin });
  ok('borrar foto → 204', r.status === 204);
  r = await req('GET', foto.url, { jar: admin });
  ok('foto borrada → 404', r.status === 404);

  // ── Importación (la usa la migración desde el VPS) ──
  const filas = [{ id: 5000, insumo: 'Azúcar', cantidad: 3 }, { id: 5001, insumo: 'Sal', cantidad: 1 }];
  r = await req('POST', '/api/importar/entradas', { body: { rows: filas }, jar: admin });
  ok('importar conserva los ids originales', r.status === 200 && r.json.importados === 2);
  await req('POST', '/api/importar/entradas', { body: { rows: filas }, jar: admin });
  r = await req('GET', '/api/store/entradas', { jar: admin });
  ok('importar dos veces no duplica (idempotente)',
    r.json.filter(e => e.id === 5000 || e.id === 5001).length === 2 && r.json.find(e => e.id === 5000).insumo === 'Azúcar');
  r = await req('POST', '/api/store/entradas', { body: { insumo: 'Nueva' }, jar: admin });
  ok('los registros nuevos siguen después de los importados', r.json.id > 5001, 'id=' + r.json.id);
  const muchas = Array.from({ length: 120 }, (_, i) => ({ id: 7000 + i, n: i }));
  r = await req('POST', '/api/importar/produccion', { body: { rows: muchas }, jar: admin });
  ok('importar 120 registros en un envío', r.status === 200 && r.json.importados === 120);
  r = await req('POST', '/api/importar/foto', { body: { id: '11111111-2222-3333-4444-555555555555', mime: 'image/png', base64: PNG_1x1 }, jar: admin });
  ok('importar una foto con su id original', r.status === 201);
  r = await req('GET', '/api/upload/11111111-2222-3333-4444-555555555555', { jar: admin });
  ok('la foto importada se ve en su url de siempre', r.status === 200 && r.buf.equals(Buffer.from(PNG_1x1, 'base64')));
  r = await req('GET', '/api/importar/conteos', { jar: admin });
  ok('conteos por store', r.status === 200 && r.json.produccion === 120 && r.json.fotos === 1, JSON.stringify(r.json));
  r = await req('POST', '/api/importar/entradas', { body: { rows: filas }, jar: viewer });
  ok('viewer no puede importar (403)', r.status === 403);
  r = await req('POST', '/api/importar/entradas', { body: { rows: [{ insumo: 'sin id' }] }, jar: admin });
  ok('importar sin id → 400', r.status === 400);

  // ── La app web se sirve desde public/ ──
  r = await req('GET', '/');
  ok('GET / sirve la app (index.html)', r.status === 200 && r.buf.toString().includes('Sistema de Producción'));
  r = await req('GET', '/produccion-core.js');
  ok('GET /produccion-core.js se sirve', r.status === 200);
  const video = await req('GET', '/intro.mp4');
  r = await req('GET', '/intro.mp4', { headers: { Range: 'bytes=0-1' } });
  ok('el video se entrega por partes (Safari/iPad)', r.status === 206 && r.buf.length === 2 &&
    r.headers.get('content-range') === `bytes 0-1/${video.buf.length}` && r.buf.equals(video.buf.subarray(0, 2)),
    `status=${r.status} range=${r.headers.get('content-range')}`);
  r = await req('GET', '/intro.mp4', { headers: { Range: 'bytes=1000-' } });
  ok('rango abierto hasta el final', r.status === 206 && r.buf.equals(video.buf.subarray(1000)));
  r = await req('GET', '/intro.mp4', { headers: { Range: 'bytes=99999999-' } });
  ok('rango fuera del archivo → 416', r.status === 416);
  ok('sin Range el video completo anuncia Accept-Ranges', video.status === 200 && video.headers.get('accept-ranges') === 'bytes');

  // ── Cerrar sesión ──
  r = await req('POST', '/api/logout', { jar: viewer });
  ok('logout → 204', r.status === 204);
  r = await req('GET', '/api/session', { jar: viewer });
  ok('después del logout ya no hay sesión', r.status === 401);

  // ── Bloqueo por fuerza bruta (al final: deja bloqueada la IP local) ──
  let ultimo;
  for (let i = 0; i < 12; i++) ultimo = await req('POST', '/api/login', { body: { password: 'mal' + i } });
  ok('demasiados intentos fallidos → 429', ultimo.status === 429, 'status=' + ultimo.status);
  r = await req('POST', '/api/login', { body: { password: 'admin123' } });
  ok('bloqueado incluso con la contraseña correcta', r.status === 429);
}

let worker;
arrancarWorker()
  .then(w => { worker = w; BASE = w.base; return main(); })
  .then(() => {
    console.log(`\n══════════════════════════════════`);
    console.log(`Resultado: ${pasadas} pasadas, ${falladas} falladas`);
  }, e => { console.error('FALLO:', e); falladas++; })
  .finally(() => {
    if (worker) worker.cerrar();
    process.exit(falladas > 0 ? 1 : 0);
  });
