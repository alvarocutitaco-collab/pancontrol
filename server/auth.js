const bcrypt = require('bcryptjs');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const { db } = require('./db');

const sessionMiddleware = session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: process.env.SESSION_SECRET || 'pancontrol-cambia-este-secreto',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === '1',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
});

function findUser(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// El login histórico de PanControl pedía solo una contraseña (sin usuario) y
// resolvía el rol según qué contraseña coincidía. Se mantiene esa experiencia:
// se prueba la contraseña contra todas las cuentas hasta encontrar coincidencia.
async function loginByPassword(password) {
  const users = db.prepare('SELECT * FROM users').all();
  for (const user of users) {
    if (await bcrypt.compare(password, user.password_hash)) {
      return { id: user.id, username: user.username, role: user.role };
    }
  }
  return null;
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'No autenticado' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Solo lectura: no tienes permiso para modificar' });
  next();
}

module.exports = { sessionMiddleware, loginByPassword, requireAuth, requireAdmin, findUser };
