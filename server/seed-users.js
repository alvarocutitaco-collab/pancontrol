// Crea o actualiza la contraseña de una cuenta.
// Uso:  node server/seed-users.js admin "nuevaClave123"
//       node server/seed-users.js viewer "otraClave"
const bcrypt = require('bcryptjs');
const { db } = require('./db');

async function main() {
  const [, , role, password] = process.argv;
  if (!['admin', 'viewer'].includes(role) || !password) {
    console.error('Uso: node server/seed-users.js <admin|viewer> "<contraseña>"');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  const username = role; // una cuenta admin y una viewer, igual que la app anterior
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE username = ?').run(hash, role, username);
    console.log(`Contraseña actualizada para "${username}".`);
  } else {
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
    console.log(`Cuenta "${username}" creada.`);
  }
}

main();
