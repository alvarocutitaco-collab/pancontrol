const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.PANCONTROL_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.PANCONTROL_DB || path.join(DATA_DIR, 'pancontrol.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Los mismos "stores" que usaba IndexedDB en la app anterior. Cada fila guarda
// el registro completo como JSON, igual que hacía IndexedDB (los campos varían
// según origen: manual u OCR), evitando tener que rehacer un esquema relacional
// estricto para reproducir exactamente lo que la app ya sabe leer/escribir.
const STORES = ['entradas', 'salidas_ins', 'produccion', 'salida_prod', 'inventario', 'catalogos',
  // Módulo "Producción y Estandarización" (recetas, versiones, órdenes, lotes, calidad)
  'est_ingredientes', 'est_productos', 'est_recetas', 'est_versiones', 'est_ordenes', 'est_lotes', 'est_auditoria'];

for (const store of STORES) {
  db.exec(`CREATE TABLE IF NOT EXISTS store_${store} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL
  )`);
}

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','viewer'))
)`);

function isValidStore(store) {
  return STORES.includes(store);
}

function storeAll(store) {
  const rows = db.prepare(`SELECT id, data FROM store_${store} ORDER BY id ASC`).all();
  return rows.map(r => ({ id: r.id, ...JSON.parse(r.data) }));
}

function storeAdd(store, data) {
  const { id, ...rest } = data || {};
  const info = db.prepare(`INSERT INTO store_${store} (data) VALUES (?)`).run(JSON.stringify(rest));
  return { id: info.lastInsertRowid, ...rest };
}

function storePut(store, id, data) {
  const { id: _drop, ...rest } = data || {};
  const info = db.prepare(`UPDATE store_${store} SET data = ? WHERE id = ?`).run(JSON.stringify(rest), id);
  if (info.changes === 0) return null;
  return { id, ...rest };
}

function storeDel(store, id) {
  const info = db.prepare(`DELETE FROM store_${store} WHERE id = ?`).run(id);
  return info.changes > 0;
}

module.exports = { db, STORES, isValidStore, storeAll, storeAdd, storePut, storeDel, DATA_DIR };
