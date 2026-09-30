// Copia TODOS los datos de este servidor (base SQLite + fotos) a la nueva app
// en Cloudflare. Se corre UNA vez, en el VPS, cuando la app de Cloudflare ya
// está publicada y con su contraseña de administrador configurada.
//
// Uso:  node server/migrar-a-cloudflare.js https://pancontrol.TU-CUENTA.workers.dev
//       (pide la contraseña de administrador de la app NUEVA)
//
// No borra ni cambia nada en este servidor: solo lee. Conserva los ids de
// cada registro, así las referencias internas (recetas, versiones, fotos...)
// siguen funcionando. Si se corta a la mitad, se puede volver a correr.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.PANCONTROL_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.PANCONTROL_DB || path.join(DATA_DIR, 'pancontrol.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_FILAS = 200;              // lo que acepta /api/importar por envío
const MAX_BYTES = 800 * 1024;       // tamaño máximo de cada envío
const FOTO_MAX_BYTES = 1400 * 1024; // tope de foto en la app nueva

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(texto, r => { rl.close(); res(r.trim()); }));
}

let cookie = '';
async function api(base, method, ruta, body) {
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(base + ruta, {
        method,
        headers: Object.assign({ Cookie: cookie }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const texto = await res.text();
      let json = null; try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* no-JSON */ }
      if (res.status >= 500 && intento < 4) throw new Error('Error ' + res.status);
      return { status: res.status, json };
    } catch (e) {
      if (intento >= 4) throw e;
      await new Promise(r => setTimeout(r, 2000 * intento));
    }
  }
}

// Agrupa filas en envíos de hasta MAX_FILAS registros y MAX_BYTES.
function enLotes(filas) {
  const lotes = [];
  let actual = [], bytes = 0;
  for (const f of filas) {
    const tam = Buffer.byteLength(JSON.stringify(f));
    if (actual.length && (actual.length >= MAX_FILAS || bytes + tam > MAX_BYTES)) { lotes.push(actual); actual = []; bytes = 0; }
    actual.push(f); bytes += tam;
  }
  if (actual.length) lotes.push(actual);
  return lotes;
}

async function main() {
  const args = process.argv.slice(2);
  const forzar = args.includes('--forzar');
  const posicionales = args.filter(a => a !== '--forzar');
  let base = posicionales[0];
  if (!base) {
    console.error('Uso: node server/migrar-a-cloudflare.js https://pancontrol.TU-CUENTA.workers.dev');
    process.exit(1);
  }
  if (!/^https?:\/\//.test(base)) base = 'https://' + base;
  base = base.replace(/\/+$/, '');
  if (!fs.existsSync(DB_PATH)) { console.error('No encuentro la base de datos en ' + DB_PATH); process.exit(1); }

  const password = posicionales[1] || process.env.PANCONTROL_ADMIN_PASSWORD ||
    await preguntar('Contraseña de ADMINISTRADOR de la app nueva (la que pusiste en Cloudflare): ');

  console.log('\nConectando con ' + base + ' ...');
  const login = await api(base, 'POST', '/api/login', { password });
  if (login.status !== 200 || !login.json || login.json.role !== 'admin') {
    console.error('❌ No se pudo entrar como administrador: ' + ((login.json && login.json.error) || ('error ' + login.status)));
    process.exit(1);
  }

  const remotos = await api(base, 'GET', '/api/importar/conteos');
  if (remotos.status !== 200) { console.error('❌ La app nueva no respondió los conteos (error ' + remotos.status + ')'); process.exit(1); }
  const conDatos = Object.entries(remotos.json).filter(([, n]) => n > 0);
  if (conDatos.length && !forzar) {
    console.error('\n⚠ La app nueva YA tiene datos (' + conDatos.map(([s, n]) => `${s}: ${n}`).join(', ') + ').');
    console.error('  Si es porque ya corriste esta migración antes, vuelve a correrla agregando --forzar al final.');
    console.error('  Si creaste datos de prueba en la app nueva, esos podrían sobrescribirse.');
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const tablas = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'store\\_%' ESCAPE '\\' ORDER BY name`)
    .all().map(t => t.name);
  const locales = {};
  const problemas = [];

  console.log('\n📦 Copiando registros...');
  for (const tabla of tablas) {
    const store = tabla.slice('store_'.length);
    const filas = db.prepare(`SELECT id, data FROM ${tabla} ORDER BY id`).all().map(r => {
      const { id, ...rest } = JSON.parse(r.data);
      return { id: r.id, ...rest };
    });
    locales[store] = filas.length;
    if (!filas.length) continue;
    let enviados = 0;
    for (const lote of enLotes(filas)) {
      const r = await api(base, 'POST', '/api/importar/' + store, { rows: lote });
      if (r.status !== 200) {
        problemas.push(`${store}: ${(r.json && r.json.error) || ('error ' + r.status)}`);
        break;
      }
      enviados += lote.length;
      process.stdout.write(`\r   ${store}: ${enviados} de ${filas.length}`);
    }
    process.stdout.write('\n');
  }

  console.log('\n📷 Copiando fotos...');
  let fotos = 0;
  const archivos = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : [];
  for (const archivo of archivos) {
    const m = /^([a-f0-9-]{36})\.(jpg|png|webp)$/.exec(archivo);
    if (!m) continue;
    const buf = fs.readFileSync(path.join(UPLOAD_DIR, archivo));
    if (buf.length > FOTO_MAX_BYTES) { problemas.push(`foto ${archivo}: muy grande (${Math.round(buf.length / 1024)} KB)`); continue; }
    const r = await api(base, 'POST', '/api/importar/foto', { id: m[1], mime: MIME[m[2]], base64: buf.toString('base64') });
    if (r.status !== 201) { problemas.push(`foto ${archivo}: ${(r.json && r.json.error) || ('error ' + r.status)}`); continue; }
    fotos++;
    process.stdout.write(`\r   ${fotos} foto(s)`);
  }
  locales.fotos = fotos;
  process.stdout.write('\n');

  // Verificación: la app nueva debe tener al menos lo que hay aquí.
  const despues = (await api(base, 'GET', '/api/importar/conteos')).json || {};
  console.log('\n🔎 Verificación (este servidor → app nueva):');
  for (const [store, n] of Object.entries(locales)) {
    if (!n && !despues[store]) continue;
    const bien = (despues[store] || 0) >= n;
    if (!bien) problemas.push(`${store}: faltan registros (${despues[store] || 0} de ${n})`);
    console.log(`   ${bien ? '✓' : '✗'} ${store}: ${n} → ${despues[store] || 0}`);
  }

  if (problemas.length) {
    console.error('\n❌ Hubo problemas:\n   - ' + problemas.join('\n   - '));
    console.error('   Puedes volver a correr el comando agregando --forzar al final.');
    process.exit(1);
  }
  console.log('\n✅ Listo. Todos los datos están en la app nueva. Entra a ' + base + ' y revísalos.');
}

main().catch(e => { console.error('\n❌ Error: ' + (e && e.message || e)); process.exit(1); });
