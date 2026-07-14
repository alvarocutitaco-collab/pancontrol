const express = require('express');
const { loginByPassword } = require('../auth');

const router = express.Router();

// Bloqueo simple por IP contra intentos de fuerza bruta sobre la contraseña.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function isBlocked(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(ip); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function registerFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) { attempts.set(ip, { count: 1, first: Date.now() }); return; }
  rec.count++;
}
function clearFailures(ip) { attempts.delete(ip); }

router.post('/login', async (req, res) => {
  const ip = req.ip;
  if (isBlocked(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Falta la contraseña' });
  const user = await loginByPassword(String(password));
  if (!user) { registerFailure(ip); return res.status(401).json({ error: 'Contraseña incorrecta' }); }
  clearFailures(ip);
  req.session.user = user;
  res.json({ username: user.username, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

router.get('/session', (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'No autenticado' });
  const { username, role } = req.session.user;
  res.json({ username, role });
});

module.exports = router;
