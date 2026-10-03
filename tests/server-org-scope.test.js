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
const escenarioOrgScope = require('./lib/org-scope-scenario');
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

  await escenarioOrgScope({ req, ok, admin, viewer });
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
