const express = require('express');
const path = require('path');
const { requireAuth, requireAdmin } = require('../auth');
const { db, storeGet, storeAll, storeAdd, orgDefaultId, orgDeRegistro } = require('../db');
const { orgActiva, setOrgActiva, logAcceso } = require('../org-scope');
// Núcleo de dominio compartido con el frontend (UMD: también exporta en Node).
const EstCore = require(path.join(__dirname, '..', '..', 'public', 'produccion-core.js'));

const router = express.Router();

function orgExiste(id) {
  return !!db.prepare(`SELECT id FROM store_est_organizaciones WHERE id = ?`).get(id);
}

// Organización activa de la sesión.
router.get('/activa', requireAuth, (req, res) => {
  res.json({ id: orgActiva(req) });
});
router.post('/activa', requireAuth, (req, res) => {
  const id = Number(req.body && req.body.id);
  if (!Number.isInteger(id) || !orgExiste(id)) return res.status(400).json({ error: 'Organización inválida' });
  setOrgActiva(req, id);
  logAcceso(req, 'org.activar', { organizacion: id });
  res.json({ id });
});

// Transferencia de una receta a otra organización, CON la autorización de
// confidencialidad verificada en el servidor (no solo en la interfaz). Copia la
// receta y todas sus versiones; la copia queda como "interna" en el destino.
router.post('/transferir-receta', requireAdmin, (req, res) => {
  const recetaId = Number(req.body && req.body.recetaId);
  const destinoOrgId = Number(req.body && req.body.destinoOrgId);
  const autorizadoPor = String((req.body && req.body.autorizadoPor) || '').trim() || (req.session.user.username || req.session.user.role);
  if (!Number.isInteger(recetaId) || !Number.isInteger(destinoOrgId)) return res.status(400).json({ error: 'Datos inválidos' });
  if (!orgExiste(destinoOrgId)) return res.status(400).json({ error: 'Organización destino inválida' });

  const receta = storeGet('est_recetas', recetaId);
  if (!receta) return res.status(404).json({ error: 'Receta no encontrada' });

  const def = orgDefaultId();
  const origen = orgDeRegistro(receta, def);
  if (String(origen) === String(destinoOrgId)) return res.status(400).json({ error: 'La receta ya pertenece a esa organización' });

  const nivel = EstCore.nivelConfidencial(receta);
  if (!EstCore.puedeTransferirReceta(nivel)) {
    logAcceso(req, 'org.transferencia_denegada', { recetaId, nivel, destinoOrgId });
    return res.status(403).json({ error: 'La confidencialidad de la receta no permite copiarla a otra organización' });
  }

  const ahora = new Date().toISOString();
  const copia = storeAdd('est_recetas', {
    nombre: receta.nombre, tipo: receta.tipo, productoId: null,
    organizacion: destinoOrgId, confidencialidad: 'interna',
    transferidaDe: { organizacion: origen, recetaId, fecha: ahora, por: autorizadoPor },
    createdAt: ahora
  });
  const versiones = storeAll('est_versiones').filter(v => v.recetaId === recetaId);
  for (const v of versiones) {
    const { id, ...rest } = v;
    storeAdd('est_versiones', { ...rest, recetaId: copia.id, createdAt: ahora, updatedAt: ahora });
  }

  const vigente = versiones.find(v => v.estado === 'aprobada') || versiones.sort((a, b) => b.numero - a.numero)[0] || null;
  storeAdd('est_exportaciones', {
    fecha: ahora, usuario: req.session.user.username || req.session.user.role,
    recetaId, recetaNombre: receta.nombre,
    versionId: vigente ? vigente.id : null, versionNumero: vigente ? vigente.numero : null,
    nivel, formato: 'transferencia', destino: 'transferencia',
    organizacionOrigen: origen, organizacionDestino: destinoOrgId, autorizadoPor
  });
  logAcceso(req, 'org.transferencia', { recetaId, destinoOrgId, nuevaRecetaId: copia.id, autorizadoPor });

  res.status(201).json({ id: copia.id, versiones: versiones.length });
});

module.exports = router;
