// Levanta el Worker de Cloudflare en local (`wrangler dev`) con una base D1
// temporal, para las pruebas. Devuelve { base, cerrar }.
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

module.exports = function arrancarWorker({ adminPassword = 'admin123', viewerPassword = 'ver123' } = {}) {
  const port = 8700 + Math.floor(Math.random() * 200);
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'pancontrol-worker-'));
  const proc = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist,
    '--var', 'ADMIN_PASSWORD:' + adminPassword, '--var', 'VIEWER_PASSWORD:' + viewerPassword],
  { cwd: path.join(__dirname, '..', '..'), detached: true, env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false', CI: '1' }) });
  const cerrar = () => {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch (e) { /* ya terminó */ }
    fs.rmSync(persist, { recursive: true, force: true });
  };
  let log = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cerrar(); reject(new Error('wrangler dev no arrancó:\n' + log)); }, 90000);
    const onData = d => {
      log += d;
      if (/Ready on/.test(log)) { clearTimeout(t); resolve({ base: `http://127.0.0.1:${port}`, cerrar }); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', code => { clearTimeout(t); reject(new Error('wrangler dev terminó (' + code + '):\n' + log)); });
  });
};
