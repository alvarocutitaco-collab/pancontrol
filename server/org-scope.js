// Ayudantes para el aislamiento por organización a nivel de servidor.
// La "organización activa" vive en la sesión: el frontend la sincroniza al
// cambiarla (POST /api/org/activa). Si la sesión no tiene ninguna, se usa la
// organización por defecto (la más antigua).
const { orgDefaultId, storeAdd } = require('./db');

function orgActiva(req) {
  const s = req.session && req.session.orgActiva;
  return s != null ? s : orgDefaultId();
}
function setOrgActiva(req, id) {
  if (req.session) req.session.orgActiva = id;
}

// Registra un evento de acceso/seguridad en est_accesos. Nunca debe romper la
// petición: si el log falla, se ignora.
function logAcceso(req, accion, detalle) {
  try {
    const user = (req.session && req.session.user) || {};
    storeAdd('est_accesos', {
      fecha: new Date().toISOString(),
      usuario: user.username || user.role || 'desconocido',
      rol: user.role || null,
      accion,
      organizacion: orgActiva(req),
      detalle: detalle || null
    });
  } catch (e) { /* el log es best-effort */ }
}

module.exports = { orgActiva, setOrgActiva, logAcceso };
