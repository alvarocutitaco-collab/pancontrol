const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

// Las imágenes se guardan en disco (no en la base de datos); las entidades
// solo guardan la referencia {id, url}. La carpeta vive junto a la base de
// datos, así el respaldo del servidor (o copiar data/) las incluye.
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const router = express.Router();

// Subir una foto (solo admin). Recibe un dataURL base64 (ya comprimido en el
// cliente). Devuelve {id, url}. La url es servida por GET /api/upload/:id.
router.post('/', requireAdmin, (req, res) => {
  const dataUrl = (req.body && req.body.dataUrl) || '';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return res.status(400).json({ error: 'Imagen inválida (usa JPG, PNG o WEBP)' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return res.status(413).json({ error: 'La imagen es muy grande (máx 6 MB)' });
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(UPLOAD_DIR, id + '.' + EXT[m[1]]), buf);
  res.status(201).json({ id, url: '/api/upload/' + id });
});

function findFile(id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) return null; // solo UUIDs válidos
  for (const ext of Object.values(EXT)) {
    const f = path.join(UPLOAD_DIR, id + '.' + ext);
    if (fs.existsSync(f)) return { f, ext };
  }
  return null;
}

// Ver una foto (requiere sesión; el navegador manda la cookie automáticamente).
router.get('/:id', requireAuth, (req, res) => {
  const found = findFile(req.params.id);
  if (!found) return res.status(404).end();
  const mime = Object.keys(EXT).find(k => EXT[k] === found.ext) || 'application/octet-stream';
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(found.f).pipe(res);
});

// Borrar una foto (solo admin).
router.delete('/:id', requireAdmin, (req, res) => {
  const found = findFile(req.params.id);
  if (found) { try { fs.unlinkSync(found.f); } catch (e) {} }
  res.status(204).end();
});

module.exports = router;
