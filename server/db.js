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
  'est_ingredientes', 'est_productos', 'est_recetas', 'est_versiones', 'est_ordenes', 'est_lotes', 'est_auditoria',
  'est_organizaciones', 'est_exportaciones', 'est_accesos', 'est_mediciones'];

// Stores cuya propiedad es de una organización. El servidor filtra las lecturas
// y valida/estampa las escrituras por la organización activa de la sesión, para
// que el aislamiento no dependa solo de que la interfaz oculte los datos.
//   - field  : el registro trae directamente el campo `organizacion`.
//   - parent : el registro hereda la organización de su "padre" (ej.: una
//              versión pertenece a la organización de su receta).
const ORG_SCOPE = {
  est_productos:  { field: 'organizacion' },
  est_recetas:    { field: 'organizacion' },
  est_versiones:  { parent: 'est_recetas', key: 'recetaId' },
  est_mediciones: { field: 'organizacion' }
};
function isOrgScoped(store) { return Object.prototype.hasOwnProperty.call(ORG_SCOPE, store); }

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

function storeGet(store, id) {
  const row = db.prepare(`SELECT id, data FROM store_${store} WHERE id = ?`).get(id);
  return row ? { id: row.id, ...JSON.parse(row.data) } : null;
}

function storeDel(store, id) {
  const info = db.prepare(`DELETE FROM store_${store} WHERE id = ?`).run(id);
  return info.changes > 0;
}

// ── Resolución de organización (para el aislamiento del servidor) ──────────
// La organización por defecto es la más antigua (menor id). Los registros sin
// organización se consideran de ella (coincide con EstCore.perteneceAOrg).
function orgDefaultId() {
  const row = db.prepare(`SELECT MIN(id) AS id FROM store_est_organizaciones`).get();
  return row && row.id != null ? row.id : null;
}
function orgDeRegistro(dataObj, defaultId) {
  const o = dataObj && dataObj.organizacion;
  return (o == null || o === '') ? defaultId : o;
}
// Contexto reutilizable para resolver la organización de muchas filas sin
// recalcular índices por cada una.
function buildOrgCtx() {
  const def = orgDefaultId();
  const parents = {};
  parents.est_recetas = new Map(storeAll('est_recetas').map(r => [r.id, orgDeRegistro(r, def)]));
  parents.est_productos = new Map(storeAll('est_productos').map(p => [p.id, orgDeRegistro(p, def)]));
  return { def, parents };
}
// Organización efectiva de una fila de un store con scope (o null si no aplica).
function orgDeFila(store, row, ctx) {
  const cfg = ORG_SCOPE[store];
  if (!cfg) return null;
  if (cfg.field) return orgDeRegistro(row, ctx.def);
  const pmap = ctx.parents[cfg.parent];
  const org = pmap && pmap.get(row[cfg.key]);
  return org == null ? ctx.def : org;
}

module.exports = {
  db, STORES, isValidStore, storeAll, storeAdd, storePut, storeDel, storeGet, DATA_DIR,
  ORG_SCOPE, isOrgScoped, orgDefaultId, orgDeRegistro, buildOrgCtx, orgDeFila
};
