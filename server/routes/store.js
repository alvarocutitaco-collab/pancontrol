const express = require('express');
const { isValidStore, storeAll, storeAdd, storePut, storeDel } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

router.use('/:store', (req, res, next) => {
  if (!isValidStore(req.params.store)) return res.status(404).json({ error: 'Store desconocido' });
  next();
});

router.get('/:store', requireAuth, (req, res) => {
  res.json(storeAll(req.params.store));
});

router.post('/:store', requireAdmin, (req, res) => {
  res.status(201).json(storeAdd(req.params.store, req.body || {}));
});

router.put('/:store/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const updated = storePut(req.params.store, id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'No encontrado' });
  res.json(updated);
});

router.delete('/:store/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const ok = storeDel(req.params.store, id);
  if (!ok) return res.status(404).json({ error: 'No encontrado' });
  res.status(204).end();
});

module.exports = router;
