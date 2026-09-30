// ════════════════════════════════════════════════════════════════
// Prueba de la MIGRACIÓN VPS → Cloudflare (server/migrar-a-cloudflare.js).
// Arma una base SQLite como la del VPS (con fotos y huecos en los ids), la
// migra a un Worker local (`wrangler dev`) y verifica que TODO llegue igual.
// Ejecutar con:  node tests/migracion.test.js   (requiere `npm install`)
// ════════════════════════════════════════════════════════════════
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const arrancarWorker = require('./lib/wrangler-dev');

// Base "del VPS" temporal (debe fijarse ANTES de requerir server/db).
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pancontrol-vps-'));
process.env.PANCONTROL_DATA_DIR = DATA_DIR;
const { STORES, storeAdd, storeDel, storeAll } = require('../server/db');

let pasadas = 0, falladas = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ✓ ' + nombre); }
  else { falladas++; console.error('  ✗ ' + nombre + (extra ? '\n    ' + extra : '')); }
}

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FOTO_ID = 'abcdef12-3456-7890-abcd-ef1234567890';

function sembrarVps() {
  const org = storeAdd('est_organizaciones', { nombre: 'Don Pancho' });
  const receta = storeAdd('est_recetas', { nombre: 'Pan francés', tipo: 'sub', organizacion: org.id });
  storeAdd('est_versiones', { recetaId: receta.id, numero: 1, estado: 'aprobada', componentes: [{ ing: 'Harina', g: 1000 }] });
  storeAdd('est_ordenes', { recetaId: receta.id, fotos: [{ id: FOTO_ID, url: '/api/upload/' + FOTO_ID, tipo: 'miga' }] });
  for (let i = 0; i < 450; i++) storeAdd('entradas', { fecha: '2026-09-01', insumo: 'Harina ' + i, cantidad: i, texto: 'ñandú "comillas" \\ ' + i });
  storeDel('entradas', 3); // hueco en los ids: la migración debe respetarlos
  storeAdd('catalogos', { insumos: ['Harina', 'Azúcar'], productos: ['Pan'] });
  storeAdd('produccion', {});
  fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', FOTO_ID + '.png'), Buffer.from(PNG_1x1, 'base64'));
}

function migrar(base, extra = []) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'server', 'migrar-a-cloudflare.js'), base, 'admin123', ...extra],
    { env: Object.assign({}, process.env, { PANCONTROL_DATA_DIR: DATA_DIR }), encoding: 'utf8' });
}

async function main(base) {
  sembrarVps();

  const r1 = migrar(base);
  ok('la migración termina bien', r1.status === 0, r1.stdout + r1.stderr);

  // Entrar a la app nueva y comparar store por store (con ids).
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const get = async p => (await fetch(base + p, { headers: { Cookie: cookie } }));
  let iguales = true, detalle = '';
  for (const store of STORES) {
    const remoto = await (await get('/api/store/' + store + '?all=1')).json();
    const local = storeAll(store);
    if (JSON.stringify(remoto) !== JSON.stringify(local)) { iguales = false; detalle += `${store}: ${local.length} → ${remoto.length}; `; }
  }
  ok('todos los stores quedaron idénticos (mismos ids y datos)', iguales, detalle);
  const entradas = await (await get('/api/store/entradas')).json();
  ok('se respetan los huecos de ids (el 3 no existe)', entradas.length === 449 && !entradas.some(e => e.id === 3));
  const foto = await get('/api/upload/' + FOTO_ID);
  ok('la foto se ve en la misma url que en el VPS',
    foto.status === 200 && Buffer.from(await foto.arrayBuffer()).equals(Buffer.from(PNG_1x1, 'base64')));
  const recetas = await (await get('/api/store/est_recetas')).json();
  ok('las recetas se ven con la organización por defecto', recetas.length === 1 && recetas[0].nombre === 'Pan francés');

  const r2 = migrar(base);
  ok('correrla de nuevo sin --forzar se detiene (la app nueva ya tiene datos)', r2.status === 1 && /YA tiene datos/.test(r2.stderr), r2.stderr);
  const r3 = migrar(base, ['--forzar']);
  ok('con --forzar se puede repetir sin duplicar', r3.status === 0 &&
    (await (await get('/api/store/entradas')).json()).length === 449, r3.stdout + r3.stderr);

  const r4 = spawnSync(process.execPath, [path.join(__dirname, '..', 'server', 'migrar-a-cloudflare.js'), base, 'clave-mala'],
    { env: Object.assign({}, process.env, { PANCONTROL_DATA_DIR: DATA_DIR }), encoding: 'utf8' });
  ok('con una contraseña incorrecta avisa y no copia nada', r4.status === 1 && /No se pudo entrar/.test(r4.stderr), r4.stderr);
}

let worker;
arrancarWorker()
  .then(w => { worker = w; return main(w.base); })
  .then(() => {
    console.log(`\n══════════════════════════════════`);
    console.log(`Resultado: ${pasadas} pasadas, ${falladas} falladas`);
  }, e => { console.error('FALLO:', e); falladas++; })
  .finally(() => {
    if (worker) worker.cerrar();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    process.exit(falladas > 0 ? 1 : 0);
  });
