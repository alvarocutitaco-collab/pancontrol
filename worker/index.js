// ════════════════════════════════════════════════════════════════
// PanControl — backend en Cloudflare Workers + D1 (plan gratis).
// Reemplaza al servidor Express de server/ con la MISMA API (/api/...), así el
// frontend de public/ funciona sin cambios. Los archivos de public/ los sirve
// Cloudflare directamente (ver [assets] en wrangler.toml); este Worker solo
// atiende las rutas /api/.
//
// Límites del plan gratis que condicionan el diseño:
//  - 10 ms de CPU por petición → se evita parsear JSON cuando no hace falta.
//  - 50 consultas a D1 por petición → inserciones múltiples en una sola consulta.
//  - 5 M filas leídas por día → las lecturas usan ETag con un contador global
//    de versión: si nada cambió, se responde 304 leyendo 1 fila, no la tabla.
//  - 2 MB por fila en D1 → las fotos se guardan en base64 con tope de tamaño.
// ════════════════════════════════════════════════════════════════
import EstCore from '../public/produccion-core.js';

// Mismos stores que server/db.js. Para agregar un tipo de dato nuevo, añádelo
// aquí: la tabla se crea sola en el siguiente arranque.
export const STORES = ['entradas', 'salidas_ins', 'produccion', 'salida_prod', 'inventario', 'catalogos',
  // Módulo "Producción y Estandarización" (recetas, versiones, órdenes, lotes, calidad)
  'est_ingredientes', 'est_productos', 'est_recetas', 'est_versiones', 'est_ordenes', 'est_lotes', 'est_auditoria',
  'est_organizaciones', 'est_exportaciones', 'est_accesos', 'est_mediciones',
  'est_operadores', 'est_certificaciones'];

// Stores cuya propiedad es de una organización (igual que server/db.js).
const ORG_SCOPE = {
  est_productos:  { field: 'organizacion' },
  est_recetas:    { field: 'organizacion' },
  est_versiones:  { parent: 'est_recetas', key: 'recetaId' },
  est_mediciones: { field: 'organizacion' },
  est_operadores: { field: 'organizacion' },
  est_certificaciones: { field: 'organizacion' }
};
const isOrgScoped = store => Object.prototype.hasOwnProperty.call(ORG_SCOPE, store);
const isValidStore = store => STORES.includes(store);

const COOKIE = 'pc_sess';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // segundos (igual que el servidor Express)
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const FOTO_MAX_BYTES = 1400 * 1024; // en base64 ocupa ~1.9 MB, bajo el tope de 2 MB por fila de D1
const MIME_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const FILAS_POR_INSERT = 45; // D1 admite hasta 100 parámetros por consulta (2 por fila)

// ── Respuestas ────────────────────────────────────────────────────
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}
const err = (status, error) => json({ error }, status);
async function leerJson(request) {
  try { return (await request.json()) || {}; } catch (e) { return {}; }
}

// ── Esquema (se crea solo, una vez por instancia) ─────────────────
// Se guarda solo un booleano (no la promesa): en Workers no se debe esperar
// desde una petición una operación de E/S iniciada por otra. Si dos peticiones
// arrancan a la vez, ambas crean el esquema; es idempotente.
let esquemaListo = false;
async function asegurarEsquema(db) {
  if (esquemaListo) return;
  await crearEsquema(db);
  esquemaListo = true;
}
async function crearEsquema(db) {
  const tablas = [...STORES.map(s => 'store_' + s), 'meta', 'fotos', 'login_fallos'];
  const marcas = tablas.map(() => '?').join(',');
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN (${marcas})`)
    .bind(...tablas).first();
  if (n === tablas.length) return;
  await db.batch([
    ...STORES.map(s => db.prepare(`CREATE TABLE IF NOT EXISTS store_${s} (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)`)),
    db.prepare(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fotos (id TEXT PRIMARY KEY, mime TEXT NOT NULL, b64 TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS login_fallos (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, desde INTEGER NOT NULL)`),
    db.prepare(`INSERT OR IGNORE INTO meta (k, v) VALUES ('version', '0')`),
    db.prepare(`INSERT OR IGNORE INTO meta (k, v) VALUES ('session_secret', ?)`).bind(hexAleatorio(32))
  ]);
}

// Contador global de versión: toda escritura lo incrementa (en la misma
// consulta por lotes), y las lecturas lo usan como ETag.
const subirVersion = db => db.prepare(`UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'version'`);
async function leerVersion(db) {
  const row = await db.prepare(`SELECT v FROM meta WHERE k = 'version'`).first();
  return row ? row.v : '0';
}

// ── Acceso a datos ────────────────────────────────────────────────
async function filasCrudas(db, store) {
  const { results } = await db.prepare(`SELECT id, data FROM store_${store} ORDER BY id ASC`).all();
  return results;
}
const aObjeto = r => ({ id: r.id, ...JSON.parse(r.data) });
async function storeAll(db, store) { return (await filasCrudas(db, store)).map(aObjeto); }
async function storeGet(db, store, id) {
  const r = await db.prepare(`SELECT id, data FROM store_${store} WHERE id = ?`).bind(id).first();
  return r ? aObjeto(r) : null;
}
async function storeAdd(db, store, data) {
  const { id, ...rest } = data || {};
  const [res] = await db.batch([
    db.prepare(`INSERT INTO store_${store} (data) VALUES (?)`).bind(JSON.stringify(rest)),
    subirVersion(db)
  ]);
  return { id: res.meta.last_row_id, ...rest };
}
async function storePut(db, store, id, data) {
  const { id: _drop, ...rest } = data || {};
  const [res] = await db.batch([
    db.prepare(`UPDATE store_${store} SET data = ? WHERE id = ?`).bind(JSON.stringify(rest), id),
    subirVersion(db)
  ]);
  return res.meta.changes > 0 ? { id, ...rest } : null;
}
async function storeDel(db, store, id) {
  const [res] = await db.batch([db.prepare(`DELETE FROM store_${store} WHERE id = ?`).bind(id), subirVersion(db)]);
  return res.meta.changes > 0;
}
// Inserta muchas filas con pocas consultas. Con conId=true respeta el id de
// cada fila (lo usa la migración para no romper referencias entre registros).
async function insertarVarios(db, store, filas, conId) {
  const stmts = [];
  for (let i = 0; i < filas.length; i += FILAS_POR_INSERT) {
    const grupo = filas.slice(i, i + FILAS_POR_INSERT);
    const params = [];
    for (const f of grupo) {
      const { id, ...rest } = f;
      if (conId) params.push(id);
      params.push(JSON.stringify(rest));
    }
    const valores = grupo.map(() => conId ? '(?, ?)' : '(?)').join(', ');
    const sql = conId
      ? `INSERT OR REPLACE INTO store_${store} (id, data) VALUES ${valores}`
      : `INSERT INTO store_${store} (data) VALUES ${valores}`;
    stmts.push(db.prepare(sql).bind(...params));
  }
  if (!stmts.length) return;
  await db.batch([...stmts, subirVersion(db)]);
}
// Arma el JSON de la respuesta sin parsear cada registro (ahorra CPU).
function filasAJson(rows) {
  return '[' + rows.map(r => r.data === '{}' ? `{"id":${r.id}}` : `{"id":${r.id},${r.data.slice(1)}`).join(',') + ']';
}

// ── Organizaciones (igual que server/db.js y server/org-scope.js) ─
async function orgDefaultId(db) {
  const row = await db.prepare(`SELECT MIN(id) AS id FROM store_est_organizaciones`).first();
  return row && row.id != null ? row.id : null;
}
function orgDeRegistro(dataObj, defaultId) {
  const o = dataObj && dataObj.organizacion;
  return (o == null || o === '') ? defaultId : o;
}
// Contexto para resolver la organización de muchas filas. Solo carga los
// padres que el store necesita (hoy: recetas, para las versiones).
async function buildOrgCtx(db, store) {
  const def = await orgDefaultId(db);
  const parents = {};
  const cfg = ORG_SCOPE[store];
  if (cfg && cfg.parent) {
    const { results } = await db.prepare(`SELECT id, json_extract(data, '$.organizacion') AS o FROM store_${cfg.parent}`).all();
    parents[cfg.parent] = new Map(results.map(r => [r.id, orgDeRegistro({ organizacion: r.o }, def)]));
  }
  return { def, parents };
}
function orgDeFila(store, row, ctx) {
  const cfg = ORG_SCOPE[store];
  if (!cfg) return null;
  if (cfg.field) return orgDeRegistro(row, ctx.def);
  const pmap = ctx.parents[cfg.parent];
  const org = pmap && pmap.get(row[cfg.key]);
  return org == null ? ctx.def : org;
}
async function orgActiva(c) {
  return c.sesion.o != null ? c.sesion.o : orgDefaultId(c.db);
}
// Registra un evento en est_accesos. Nunca rompe la petición.
async function logAcceso(c, accion, detalle) {
  try {
    await storeAdd(c.db, 'est_accesos', {
      fecha: new Date().toISOString(),
      usuario: c.sesion.u || c.sesion.r || 'desconocido',
      rol: c.sesion.r || null,
      accion,
      organizacion: await orgActiva(c),
      detalle: detalle || null
    });
  } catch (e) { /* el log es best-effort */ }
}

// ── Sesión: cookie firmada (HMAC) ─────────────────────────────────
// La clave mezcla un secreto aleatorio guardado en D1 con las contraseñas: si
// el dueño cambia una contraseña en Cloudflare, todas las sesiones se cierran.
const enc = new TextEncoder();
function hexAleatorio(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function desdeB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
let secretoSesion = null; // no cambia nunca una vez creado: se lee de D1 una vez por instancia
let claveCache = { material: null, key: null };
async function claveSesion(env, db) {
  if (!secretoSesion) {
    const row = await db.prepare(`SELECT v FROM meta WHERE k = 'session_secret'`).first();
    if (!row) throw new Error('Falta session_secret en meta');
    secretoSesion = row.v;
  }
  const material = [secretoSesion, env.ADMIN_PASSWORD || '', env.VIEWER_PASSWORD || ''].join('\u0000');
  if (claveCache.material !== material) {
    const key = await crypto.subtle.importKey('raw', enc.encode(material), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    claveCache = { material, key };
  }
  return claveCache.key;
}
async function crearCookie(env, db, sesion, url) {
  const payload = b64url(enc.encode(JSON.stringify(sesion)));
  const firma = b64url(await crypto.subtle.sign('HMAC', await claveSesion(env, db), enc.encode(payload)));
  const maxAge = Math.max(0, sesion.e - Math.floor(Date.now() / 1000));
  return `${COOKIE}=${payload}.${firma}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` +
    (url.protocol === 'https:' ? '; Secure' : '');
}
function borrarCookie(url) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (url.protocol === 'https:' ? '; Secure' : '');
}
async function leerSesion(request, env, db) {
  const cookies = request.headers.get('Cookie') || '';
  const m = cookies.split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!m) return null;
  const [payload, firma] = m.slice(COOKIE.length + 1).split('.');
  if (!payload || !firma) return null;
  try {
    const valida = await crypto.subtle.verify('HMAC', await claveSesion(env, db), desdeB64url(firma), enc.encode(payload));
    if (!valida) return null;
    const sesion = JSON.parse(new TextDecoder().decode(desdeB64url(payload)));
    if (!sesion.e || sesion.e < Math.floor(Date.now() / 1000)) return null;
    return sesion;
  } catch (e) { return null; }
}

// Contraseñas: secretos ADMIN_PASSWORD y VIEWER_PASSWORD del Worker (se
// configuran en el panel de Cloudflare). Comparación en tiempo constante.
async function igualSeguro(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i] ^ y[i];
  return dif === 0;
}
async function usuarioPorPassword(env, password) {
  if (env.ADMIN_PASSWORD && await igualSeguro(password, env.ADMIN_PASSWORD)) return { username: 'admin', role: 'admin' };
  if (env.VIEWER_PASSWORD && await igualSeguro(password, env.VIEWER_PASSWORD)) return { username: 'viewer', role: 'viewer' };
  return null;
}

// Bloqueo por IP contra fuerza bruta (en D1: el Worker no guarda memoria).
async function estaBloqueada(db, ip) {
  const r = await db.prepare(`SELECT n, desde FROM login_fallos WHERE ip = ?`).bind(ip).first();
  return !!r && Date.now() - r.desde <= WINDOW_MS && r.n >= MAX_ATTEMPTS;
}
async function registrarFallo(db, ip) {
  const ahora = Date.now();
  await db.prepare(`INSERT INTO login_fallos (ip, n, desde) VALUES (?1, 1, ?2)
    ON CONFLICT(ip) DO UPDATE SET n = CASE WHEN ?2 - desde > ?3 THEN 1 ELSE n + 1 END,
                                  desde = CASE WHEN ?2 - desde > ?3 THEN ?2 ELSE desde END`)
    .bind(ip, ahora, WINDOW_MS).run();
}

// ── Rutas: autenticación ──────────────────────────────────────────
async function rutaLogin(c) {
  const ip = c.request.headers.get('CF-Connecting-IP') || 'local';
  if (await estaBloqueada(c.db, ip)) return err(429, 'Demasiados intentos. Espera unos minutos.');
  if (!c.env.ADMIN_PASSWORD) return err(503, 'Falta configurar la contraseña ADMIN_PASSWORD en Cloudflare');
  const { password } = await leerJson(c.request);
  if (!password) return err(400, 'Falta la contraseña');
  const user = await usuarioPorPassword(c.env, String(password));
  if (!user) { await registrarFallo(c.db, ip); return err(401, 'Contraseña incorrecta'); }
  await c.db.prepare(`DELETE FROM login_fallos WHERE ip = ?`).bind(ip).run();
  const sesion = { u: user.username, r: user.role, o: null, e: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  return json(user, 200, { 'Set-Cookie': await crearCookie(c.env, c.db, sesion, c.url) });
}

// ── Rutas: CRUD genérico de stores (igual que server/routes/store.js) ─
const adminBypass = c => c.url.searchParams.get('all') === '1' && c.sesion.r === 'admin';

async function rutaStoreGet(c, store) {
  const scoped = isOrgScoped(store);
  const verTodo = adminBypass(c);
  const activa = scoped && !verTodo ? await orgActiva(c) : '';
  const etag = `W/"${await leerVersion(c.db)}-${store}-${c.sesion.r}-${activa}-${verTodo ? 1 : 0}"`;
  const cache = { ETag: etag, 'Cache-Control': 'private, no-cache' };
  if (c.request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: cache });
  let cuerpo;
  if (!scoped || verTodo) {
    cuerpo = filasAJson(await filasCrudas(c.db, store));
  } else {
    const ctx = await buildOrgCtx(c.db, store);
    const rows = (await storeAll(c.db, store)).filter(r => String(orgDeFila(store, r, ctx)) === String(activa));
    cuerpo = JSON.stringify(rows);
  }
  return new Response(cuerpo, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cache } });
}

async function rutaStorePost(c, store) {
  const body = await leerJson(c.request);
  if (isOrgScoped(store) && !adminBypass(c)) {
    const guardia = await guardarEscrituraOrg(c, store, body, 'crear');
    if (guardia) return err(guardia.status, guardia.error);
  }
  return json(await storeAdd(c.db, store, body), 201);
}

async function rutaStorePut(c, store, id) {
  const body = await leerJson(c.request);
  if (isOrgScoped(store) && !adminBypass(c)) {
    const existing = await storeGet(c.db, store, id);
    if (!existing) return err(404, 'No encontrado');
    const bloqueo = await bloquearSiOtraOrg(c, store, existing, id, 'editar');
    if (bloqueo) return err(bloqueo.status, bloqueo.error);
    const guardia = await guardarEscrituraOrg(c, store, body, 'editar');
    if (guardia) return err(guardia.status, guardia.error);
  }
  const updated = await storePut(c.db, store, id, body);
  if (!updated) return err(404, 'No encontrado');
  return json(updated);
}

async function rutaStoreDelete(c, store, id) {
  if (isOrgScoped(store) && !adminBypass(c)) {
    const existing = await storeGet(c.db, store, id);
    if (!existing) return err(404, 'No encontrado');
    const bloqueo = await bloquearSiOtraOrg(c, store, existing, id, 'eliminar');
    if (bloqueo) return err(bloqueo.status, bloqueo.error);
  }
  if (!await storeDel(c.db, store, id)) return err(404, 'No encontrado');
  return new Response(null, { status: 204 });
}

// Impide editar/eliminar registros de OTRA organización.
async function bloquearSiOtraOrg(c, store, existing, id, accion) {
  const ctx = await buildOrgCtx(c.db, store);
  const orgFila = orgDeFila(store, existing, ctx);
  if (String(orgFila) !== String(await orgActiva(c))) {
    await logAcceso(c, 'org.acceso_denegado', { store, id, accion, organizacionDato: orgFila });
    return { status: 403, error: 'No puedes modificar datos de otra organización' };
  }
  return null;
}

// Valida/estampa la organización de una escritura (ver server/routes/store.js).
async function guardarEscrituraOrg(c, store, body, accion) {
  const activa = await orgActiva(c);
  const cfg = ORG_SCOPE[store];
  if (cfg.field) {
    if (body.organizacion == null || body.organizacion === '') {
      body.organizacion = activa;
    } else if (String(body.organizacion) !== String(activa)) {
      await logAcceso(c, 'org.escritura_cruzada', { store, accion, organizacionDestino: body.organizacion });
    }
    return null;
  }
  const ctx = await buildOrgCtx(c.db, store);
  const orgFila = orgDeFila(store, body, ctx);
  if (String(orgFila) !== String(activa)) {
    await logAcceso(c, 'org.acceso_denegado', { store, accion, organizacionDato: orgFila });
    return { status: 403, error: 'No puedes escribir en datos de otra organización' };
  }
  return null;
}

// ── Rutas: organizaciones (igual que server/routes/org.js) ────────
async function orgExiste(db, id) {
  return !!await db.prepare(`SELECT id FROM store_est_organizaciones WHERE id = ?`).bind(id).first();
}

async function rutaOrgActivaPost(c) {
  const body = await leerJson(c.request);
  const id = Number(body.id);
  if (!Number.isInteger(id) || !await orgExiste(c.db, id)) return err(400, 'Organización inválida');
  c.sesion = { ...c.sesion, o: id };
  await logAcceso(c, 'org.activar', { organizacion: id });
  return json({ id }, 200, { 'Set-Cookie': await crearCookie(c.env, c.db, c.sesion, c.url) });
}

// Transferencia de una receta a otra organización, con la confidencialidad
// verificada en el servidor. Copia la receta y todas sus versiones.
async function rutaTransferirReceta(c) {
  const body = await leerJson(c.request);
  const recetaId = Number(body.recetaId);
  const destinoOrgId = Number(body.destinoOrgId);
  const autorizadoPor = String(body.autorizadoPor || '').trim() || (c.sesion.u || c.sesion.r);
  if (!Number.isInteger(recetaId) || !Number.isInteger(destinoOrgId)) return err(400, 'Datos inválidos');
  if (!await orgExiste(c.db, destinoOrgId)) return err(400, 'Organización destino inválida');

  const receta = await storeGet(c.db, 'est_recetas', recetaId);
  if (!receta) return err(404, 'Receta no encontrada');

  const origen = orgDeRegistro(receta, await orgDefaultId(c.db));
  if (String(origen) === String(destinoOrgId)) return err(400, 'La receta ya pertenece a esa organización');

  const nivel = EstCore.nivelConfidencial(receta);
  if (!EstCore.puedeTransferirReceta(nivel)) {
    await logAcceso(c, 'org.transferencia_denegada', { recetaId, nivel, destinoOrgId });
    return err(403, 'La confidencialidad de la receta no permite copiarla a otra organización');
  }

  const ahora = new Date().toISOString();
  const copia = await storeAdd(c.db, 'est_recetas', {
    nombre: receta.nombre, tipo: receta.tipo, productoId: null,
    organizacion: destinoOrgId, confidencialidad: 'interna',
    transferidaDe: { organizacion: origen, recetaId, fecha: ahora, por: autorizadoPor },
    createdAt: ahora
  });
  const { results } = await c.db.prepare(`SELECT id, data FROM store_est_versiones WHERE json_extract(data, '$.recetaId') = ?`)
    .bind(recetaId).all();
  const versiones = results.map(aObjeto);
  await insertarVarios(c.db, 'est_versiones',
    versiones.map(({ id, ...rest }) => ({ ...rest, recetaId: copia.id, createdAt: ahora, updatedAt: ahora })), false);

  const vigente = versiones.find(v => v.estado === 'aprobada') || versiones.sort((a, b) => b.numero - a.numero)[0] || null;
  await storeAdd(c.db, 'est_exportaciones', {
    fecha: ahora, usuario: c.sesion.u || c.sesion.r,
    recetaId, recetaNombre: receta.nombre,
    versionId: vigente ? vigente.id : null, versionNumero: vigente ? vigente.numero : null,
    nivel, formato: 'transferencia', destino: 'transferencia',
    organizacionOrigen: origen, organizacionDestino: destinoOrgId, autorizadoPor
  });
  await logAcceso(c, 'org.transferencia', { recetaId, destinoOrgId, nuevaRecetaId: copia.id, autorizadoPor });

  return json({ id: copia.id, versiones: versiones.length }, 201);
}

// ── Rutas: fotos (igual que server/routes/uploads.js, guardadas en D1) ─
const FOTO_ID = /^[a-f0-9-]{36}$/;
function base64ABytes(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const bytesDeBase64 = b64 => Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

async function guardarFoto(db, id, mime, b64) {
  if (!MIME_FOTO.includes(mime)) return err(400, 'Imagen inválida (usa JPG, PNG o WEBP)');
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return err(400, 'Imagen inválida (usa JPG, PNG o WEBP)');
  if (bytesDeBase64(b64) > FOTO_MAX_BYTES) return err(413, 'La imagen es muy grande (máx 1.4 MB)');
  await db.prepare(`INSERT OR REPLACE INTO fotos (id, mime, b64) VALUES (?, ?, ?)`).bind(id, mime, b64).run();
  return null;
}

async function rutaFotoPost(c) {
  const { dataUrl } = await leerJson(c.request);
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return err(400, 'Imagen inválida (usa JPG, PNG o WEBP)');
  const id = crypto.randomUUID();
  const fallo = await guardarFoto(c.db, id, m[1], m[2]);
  if (fallo) return fallo;
  return json({ id, url: '/api/upload/' + id }, 201);
}

async function rutaFotoGet(c, id) {
  if (!FOTO_ID.test(id)) return new Response(null, { status: 404 });
  const r = await c.db.prepare(`SELECT mime, b64 FROM fotos WHERE id = ?`).bind(id).first();
  if (!r) return new Response(null, { status: 404 });
  return new Response(base64ABytes(r.b64), { headers: { 'Content-Type': r.mime, 'Cache-Control': 'private, max-age=86400' } });
}

async function rutaFotoDelete(c, id) {
  if (FOTO_ID.test(id)) await c.db.prepare(`DELETE FROM fotos WHERE id = ?`).bind(id).run();
  return new Response(null, { status: 204 });
}

// ── Rutas: importación (la usa server/migrar-a-cloudflare.js) ─────
// Conserva los ids originales para que las referencias entre registros
// (recetaId, productoId, fotos...) sigan apuntando a lo mismo. Es idempotente:
// volver a correr la migración reemplaza cada registro por sí mismo.
async function rutaImportarStore(c, store) {
  const { rows } = await leerJson(c.request);
  if (!Array.isArray(rows)) return err(400, 'Falta "rows"');
  if (rows.length > 200) return err(413, 'Máximo 200 registros por envío');
  if (!rows.every(r => r && Number.isInteger(r.id) && r.id > 0)) return err(400, 'Cada registro necesita un id entero');
  await insertarVarios(c.db, store, rows, true);
  return json({ importados: rows.length });
}

async function rutaImportarFoto(c) {
  const { id, mime, base64 } = await leerJson(c.request);
  if (!FOTO_ID.test(String(id || ''))) return err(400, 'id de foto inválido');
  const fallo = await guardarFoto(c.db, id, String(mime || ''), String(base64 || ''));
  if (fallo) return fallo;
  return json({ id }, 201);
}

// Conteos por store (para que la migración verifique que no faltó nada).
async function rutaConteos(c) {
  const stmts = STORES.map(s => c.db.prepare(`SELECT '${s}' AS store, COUNT(*) AS n FROM store_${s}`));
  stmts.push(c.db.prepare(`SELECT 'fotos' AS store, COUNT(*) AS n FROM fotos`));
  const res = await c.db.batch(stmts);
  const out = {};
  for (const r of res) out[r.results[0].store] = r.results[0].n;
  return json(out);
}

// ── Enrutador ─────────────────────────────────────────────────────
async function manejarApi(request, env, url) {
  if (!env.DB) return err(503, 'Falta la base de datos D1 (binding "DB")');
  const db = env.DB;
  await asegurarEsquema(db);
  const c = { request, env, url, db, sesion: null };
  const metodo = request.method;
  const partes = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [p0, p1, p2] = partes;

  // Rutas públicas
  if (p0 === 'login' && partes.length === 1 && metodo === 'POST') return rutaLogin(c);
  if (p0 === 'logout' && partes.length === 1 && metodo === 'POST') {
    return new Response(null, { status: 204, headers: { 'Set-Cookie': borrarCookie(url) } });
  }

  c.sesion = await leerSesion(request, env, db);
  if (!c.sesion) return err(401, 'No autenticado');
  const esAdmin = c.sesion.r === 'admin';
  const soloAdmin = () => err(403, 'Solo lectura: no tienes permiso para modificar');

  if (p0 === 'session' && partes.length === 1 && metodo === 'GET') {
    return json({ username: c.sesion.u, role: c.sesion.r });
  }

  if (p0 === 'store' && p1) {
    if (!isValidStore(p1)) return err(404, 'Store desconocido');
    if (partes.length === 2) {
      if (metodo === 'GET') return rutaStoreGet(c, p1);
      if (metodo === 'POST') return esAdmin ? rutaStorePost(c, p1) : soloAdmin();
    }
    if (partes.length === 3 && (metodo === 'PUT' || metodo === 'DELETE')) {
      if (!esAdmin) return soloAdmin();
      const id = Number(p2);
      if (!Number.isInteger(id)) return err(400, 'id inválido');
      return metodo === 'PUT' ? rutaStorePut(c, p1, id) : rutaStoreDelete(c, p1, id);
    }
  }

  if (p0 === 'org' && partes.length === 2) {
    if (p1 === 'activa' && metodo === 'GET') return json({ id: await orgActiva(c) });
    if (p1 === 'activa' && metodo === 'POST') return rutaOrgActivaPost(c);
    if (p1 === 'transferir-receta' && metodo === 'POST') return esAdmin ? rutaTransferirReceta(c) : soloAdmin();
  }

  if (p0 === 'upload') {
    if (partes.length === 1 && metodo === 'POST') return esAdmin ? rutaFotoPost(c) : soloAdmin();
    if (partes.length === 2 && metodo === 'GET') return rutaFotoGet(c, p1);
    if (partes.length === 2 && metodo === 'DELETE') return esAdmin ? rutaFotoDelete(c, p1) : soloAdmin();
  }

  if (p0 === 'importar') {
    if (!esAdmin) return soloAdmin();
    if (p1 === 'conteos' && partes.length === 2 && metodo === 'GET') return rutaConteos(c);
    if (p1 === 'foto' && partes.length === 2 && metodo === 'POST') return rutaImportarFoto(c);
    if (p1 && partes.length === 2 && metodo === 'POST') {
      if (!isValidStore(p1)) return err(404, 'Store desconocido');
      return rutaImportarStore(c, p1);
    }
  }

  return err(404, 'Ruta no encontrada');
}

// Videos (intro y widget): se entregan por partes (HTTP Range) porque Safari
// en iPhone/iPad no reproduce un video si el servidor no lo permite. Estas
// rutas pasan primero por el Worker (run_worker_first en wrangler.toml).
const VIDEOS = ['/intro.mp4', '/doraemon.webm'];
async function servirVideo(request, env) {
  const res = await env.ASSETS.fetch(new Request(request.url));
  if (res.status !== 200) return res;
  const headers = new Headers(res.headers);
  headers.set('Accept-Ranges', 'bytes');
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('Range') || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return new Response(res.body, { status: 200, headers });
  const buf = await res.arrayBuffer();
  const total = buf.byteLength;
  let ini, fin;
  if (m[1] === '') { ini = Math.max(0, total - Number(m[2])); fin = total - 1; }
  else { ini = Number(m[1]); fin = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1); }
  if (ini > fin || ini >= total) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  headers.set('Content-Range', `bytes ${ini}-${fin}/${total}`);
  headers.set('Content-Length', String(fin - ini + 1));
  return new Response(buf.slice(ini, fin + 1), { status: 206, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (VIDEOS.includes(url.pathname) && request.method === 'GET') return servirVideo(request, env);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await manejarApi(request, env, url);
    } catch (e) {
      console.error(e && e.stack || e);
      return err(500, 'Error del servidor');
    }
  }
};
