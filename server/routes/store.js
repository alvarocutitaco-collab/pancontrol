const express = require('express');
const { isValidStore, storeAll, storeAdd, storePut, storeDel, storeGet,
  isOrgScoped, orgDefaultId, orgDeRegistro, buildOrgCtx, orgDeFila } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { orgActiva, logAcceso } = require('../org-scope');

const router = express.Router();

router.use('/:store', (req, res, next) => {
  if (!isValidStore(req.params.store)) return res.status(404).json({ error: 'Store desconocido' });
  next();
});

// Lectura: para stores con propiedad de organización se devuelven solo los
// registros de la organización activa. El admin (dueño de todas) puede pedir
// todo con ?all=1 (lo usan los respaldos del módulo).
router.get('/:store', requireAuth, (req, res) => {
  const store = req.params.store;
  const rows = storeAll(store);
  if (!isOrgScoped(store)) return res.json(rows);
  const verTodo = req.query.all === '1' && req.session.user.role === 'admin';
  if (verTodo) return res.json(rows);
  const ctx = buildOrgCtx();
  const activa = orgActiva(req);
  res.json(rows.filter(r => String(orgDeFila(store, r, ctx)) === String(activa)));
});

// El admin (dueño de todas las organizaciones) puede operar entre todas con
// ?all=1. Lo usan los respaldos/restauración del módulo. Las llamadas normales
// de la interfaz NO pasan este flag, así que siguen limitadas a la org activa.
function adminBypass(req) { return req.query.all === '1' && req.session.user.role === 'admin'; }

router.post('/:store', requireAdmin, (req, res) => {
  const store = req.params.store;
  const body = req.body || {};
  if (isOrgScoped(store) && !adminBypass(req)) {
    const guardia = guardarEscrituraOrg(req, store, body, 'crear');
    if (guardia) return res.status(guardia.status).json({ error: guardia.error });
  }
  res.status(201).json(storeAdd(store, body));
});

router.put('/:store/:id', requireAdmin, (req, res) => {
  const store = req.params.store;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  if (isOrgScoped(store) && !adminBypass(req)) {
    const existing = storeGet(store, id);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    const bloqueo = bloquearSiOtraOrg(req, store, existing, id, 'editar');
    if (bloqueo) return res.status(bloqueo.status).json({ error: bloqueo.error });
    const guardia = guardarEscrituraOrg(req, store, req.body || {}, 'editar');
    if (guardia) return res.status(guardia.status).json({ error: guardia.error });
  }
  const updated = storePut(store, id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'No encontrado' });
  res.json(updated);
});

router.delete('/:store/:id', requireAdmin, (req, res) => {
  const store = req.params.store;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  if (isOrgScoped(store) && !adminBypass(req)) {
    const existing = storeGet(store, id);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    const bloqueo = bloquearSiOtraOrg(req, store, existing, id, 'eliminar');
    if (bloqueo) return res.status(bloqueo.status).json({ error: bloqueo.error });
  }
  const ok = storeDel(store, id);
  if (!ok) return res.status(404).json({ error: 'No encontrado' });
  res.status(204).end();
});

// Impide editar/eliminar registros de OTRA organización. Devuelve un objeto de
// error si hay que bloquear, o null si la operación puede continuar.
function bloquearSiOtraOrg(req, store, existing, id, accion) {
  const ctx = buildOrgCtx();
  const orgFila = orgDeFila(store, existing, ctx);
  if (String(orgFila) !== String(orgActiva(req))) {
    logAcceso(req, 'org.acceso_denegado', { store, id, accion, organizacionDato: orgFila });
    return { status: 403, error: 'No puedes modificar datos de otra organización' };
  }
  return null;
}

// Valida/estampa la organización de una escritura. Para stores con campo propio
// (`organizacion`): si falta, se estampa la activa; si viene otra, solo el admin
// puede (queda registrada como escritura cruzada, p.ej. una transferencia). Para
// stores hijos (versiones): la escritura debe caer en una receta de la org activa.
function guardarEscrituraOrg(req, store, body, accion) {
  const ctx = buildOrgCtx();
  const activa = orgActiva(req);
  const cfg = require('../db').ORG_SCOPE[store];
  if (cfg.field) {
    if (body.organizacion == null || body.organizacion === '') {
      body.organizacion = activa;
    } else if (String(body.organizacion) !== String(activa)) {
      logAcceso(req, 'org.escritura_cruzada', { store, accion, organizacionDestino: body.organizacion });
    }
    return null;
  }
  // store hijo: resolver la org de la receta destino
  const orgFila = orgDeFila(store, body, ctx);
  if (String(orgFila) !== String(activa)) {
    logAcceso(req, 'org.acceso_denegado', { store, accion, organizacionDato: orgFila });
    return { status: 403, error: 'No puedes escribir en datos de otra organización' };
  }
  return null;
}

module.exports = router;
