// ════════════════════════════════════════════════════════════════
// Pruebas de AISLAMIENTO POR ORGANIZACIÓN en el servidor (Incremento 1c).
// Levanta la app real en un puerto efímero contra una base temporal y
// verifica que el backend —no solo la interfaz— impida ver/editar datos de
// otra organización, y que la transferencia respete la confidencialidad.
// Ejecutar con:  node tests/server-org-scope.test.js   (usa deps del proyecto)
// ════════════════════════════════════════════════════════════════
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Base de datos temporal y aislada (debe fijarse ANTES de requerir db/app).
const TMP = path.join(os.tmpdir(), 'pancontrol-test-' + process.pid + '-' + Date.now() + '.db');
process.env.PANCONTROL_DB = TMP;
process.env.SESSION_SECRET = 'test-secret';

const bcrypt = require('bcryptjs');
const { db } = require('../server/db');
db.prepare('INSERT INTO users (username,password_hash,role) VALUES (?,?,?)').run('admin', bcrypt.hashSync('admin123', 8), 'admin');
db.prepare('INSERT INTO users (username,password_hash,role) VALUES (?,?,?)').run('viewer', bcrypt.hashSync('ver123', 8), 'viewer');

const app = require('../server/index.js');
const server = app.listen(0);

let pasadas = 0, falladas = 0;
function ok(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ✓ ' + nombre); }
  else { falladas++; console.error('  ✗ ' + nombre + (extra ? '\n    ' + extra : '')); }
}

// Petición HTTP con "tarro de cookies" para conservar la sesión.
function req(method, p, { body, jar } = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, path: p, method,
      headers: Object.assign(
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        jar && jar.cookie ? { Cookie: jar.cookie } : {}
      )
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        if (jar && res.headers['set-cookie']) jar.cookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        let json = null; try { json = buf ? JSON.parse(buf) : null; } catch (e) { /* respuesta no-JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const admin = {}, viewer = {};
  await req('POST', '/api/login', { body: { password: 'admin123' }, jar: admin });
  await req('POST', '/api/login', { body: { password: 'ver123' }, jar: viewer });

  // Dos organizaciones (A la más antigua = por defecto).
  const orgA = (await req('POST', '/api/store/est_organizaciones', { body: { nombre: 'Org A' }, jar: admin })).json.id;
  const orgB = (await req('POST', '/api/store/est_organizaciones', { body: { nombre: 'Org B' }, jar: admin })).json.id;

  // Activar A y crear una receta + versión en A.
  await req('POST', '/api/org/activa', { body: { id: orgA }, jar: admin });
  const recA = (await req('POST', '/api/store/est_recetas', { body: { nombre: 'Pan A', tipo: 'sub' }, jar: admin })).json;
  ok('POST estampa la organización activa', String(recA.organizacion) === String(orgA), 'org=' + recA.organizacion);
  const verA = (await req('POST', '/api/store/est_versiones', { body: { recetaId: recA.id, numero: 1, estado: 'borrador', componentes: [] }, jar: admin })).json;

  // Activar B y crear receta en B.
  await req('POST', '/api/org/activa', { body: { id: orgB }, jar: admin });
  const recB = (await req('POST', '/api/store/est_recetas', { body: { nombre: 'Pan B', tipo: 'sub' }, jar: admin })).json;

  // Lectura scoped: con B activa solo se ven las recetas de B.
  let recs = (await req('GET', '/api/store/est_recetas', { jar: admin })).json;
  ok('GET solo devuelve recetas de la organización activa (B)',
    recs.length === 1 && recs[0].id === recB.id, 'ids=' + recs.map(r => r.id));

  // Las versiones (contenido de la fórmula) también quedan aisladas.
  let vers = (await req('GET', '/api/store/est_versiones', { jar: admin })).json;
  ok('GET est_versiones aislado por organización (no filtra la de A)',
    vers.every(v => v.recetaId !== recA.id), 'vers=' + vers.map(v => v.recetaId));

  // ?all=1 (solo admin) devuelve todo, para respaldos.
  let todas = (await req('GET', '/api/store/est_recetas?all=1', { jar: admin })).json;
  ok('GET ?all=1 (admin) devuelve todas las organizaciones', todas.length === 2, 'n=' + todas.length);

  // El viewer NO puede usar ?all=1 para saltarse el aislamiento.
  await req('POST', '/api/org/activa', { body: { id: orgB }, jar: viewer });
  let verAll = (await req('GET', '/api/store/est_recetas?all=1', { jar: viewer })).json;
  ok('viewer con ?all=1 sigue limitado a la organización activa', verAll.length === 1, 'n=' + verAll.length);

  // Editar una receta de OTRA organización (A) con B activa → bloqueado.
  let put = await req('PUT', '/api/store/est_recetas/' + recA.id, { body: { nombre: 'Hackeada' }, jar: admin });
  ok('PUT sobre datos de otra organización → 403', put.status === 403, 'status=' + put.status);
  let del = await req('DELETE', '/api/store/est_recetas/' + recA.id, { jar: admin });
  ok('DELETE sobre datos de otra organización → 403', del.status === 403, 'status=' + del.status);

  // Transferencia BLOQUEADA por confidencialidad (recA es 'interna' por defecto).
  let tr = await req('POST', '/api/org/transferir-receta', { body: { recetaId: recA.id, destinoOrgId: orgB }, jar: admin });
  ok('Transferir una receta interna → 403 (servidor aplica la confidencialidad)', tr.status === 403, 'status=' + tr.status);

  // Marcar recA como 'transferible' (con A activa) y transferir a B → permitido.
  await req('POST', '/api/org/activa', { body: { id: orgA }, jar: admin });
  await req('PUT', '/api/store/est_recetas/' + recA.id, { body: { nombre: 'Pan A', tipo: 'sub', organizacion: orgA, confidencialidad: 'transferible' }, jar: admin });
  let tr2 = await req('POST', '/api/org/transferir-receta', { body: { recetaId: recA.id, destinoOrgId: orgB, autorizadoPor: 'Alvaro' }, jar: admin });
  ok('Transferir una receta transferible → 201', tr2.status === 201, 'status=' + tr2.status);
  ok('La transferencia copió la versión', tr2.json && tr2.json.versiones === 1, 'versiones=' + (tr2.json && tr2.json.versiones));

  // La copia vive en B, como 'interna', con trazabilidad.
  let recsB = (await req('GET', '/api/store/est_recetas?all=1', { jar: admin })).json.filter(r => r.transferidaDe);
  ok('La copia queda como interna en el destino con trazabilidad',
    recsB.length === 1 && recsB[0].organizacion === orgB && recsB[0].confidencialidad === 'interna' && recsB[0].transferidaDe.recetaId === recA.id,
    JSON.stringify(recsB[0] && { org: recsB[0].organizacion, conf: recsB[0].confidencialidad }));

  // Quedó registro en est_exportaciones y en est_accesos.
  let exps = (await req('GET', '/api/store/est_exportaciones', { jar: admin })).json;
  ok('La transferencia se registró en el historial de exportaciones',
    exps.some(e => e.destino === 'transferencia' && e.autorizadoPor === 'Alvaro'));
  let accesos = (await req('GET', '/api/store/est_accesos', { jar: admin })).json;
  ok('El servidor registró accesos (activaciones, denegados, transferencia)',
    accesos.some(a => a.accion === 'org.acceso_denegado') &&
    accesos.some(a => a.accion === 'org.transferencia') &&
    accesos.some(a => a.accion === 'org.transferencia_denegada'),
    'acciones=' + [...new Set(accesos.map(a => a.accion))].join(','));

  // Un viewer no puede escribir (requireAdmin sigue vigente).
  let vpost = await req('POST', '/api/store/est_recetas', { body: { nombre: 'X', tipo: 'sub' }, jar: viewer });
  ok('viewer no puede crear (403)', vpost.status === 403, 'status=' + vpost.status);
}

main()
  .then(() => {
    console.log(`\n══════════════════════════════════`);
    console.log(`Resultado: ${pasadas} pasadas, ${falladas} falladas`);
    server.close();
    try { for (const f of fs.readdirSync(path.dirname(TMP))) if (f.startsWith(path.basename(TMP))) fs.unlinkSync(path.join(path.dirname(TMP), f)); } catch (e) {}
    process.exit(falladas > 0 ? 1 : 0);
  })
  .catch(e => { console.error('FALLO:', e); server.close(); process.exit(1); });
