// Escenario compartido de AISLAMIENTO POR ORGANIZACIÓN. Lo corren tanto la
// prueba del servidor Express (server-org-scope.test.js) como la del Worker de
// Cloudflare (worker-api.test.js): ambos backends deben comportarse igual.
'use strict';

module.exports = async function escenarioOrgScope({ req, ok, admin, viewer }) {
  // Dos organizaciones (A la más antigua = por defecto).
  const orgA = (await req('POST', '/api/store/est_organizaciones', { body: { nombre: 'Org A' }, jar: admin })).json.id;
  const orgB = (await req('POST', '/api/store/est_organizaciones', { body: { nombre: 'Org B' }, jar: admin })).json.id;

  // Activar A y crear una receta + versión en A.
  await req('POST', '/api/org/activa', { body: { id: orgA }, jar: admin });
  const recA = (await req('POST', '/api/store/est_recetas', { body: { nombre: 'Pan A', tipo: 'sub' }, jar: admin })).json;
  ok('POST estampa la organización activa', String(recA.organizacion) === String(orgA), 'org=' + recA.organizacion);
  const verA = (await req('POST', '/api/store/est_versiones', { body: { recetaId: recA.id, numero: 1, estado: 'borrador', componentes: [] }, jar: admin })).json;

  // Activar B y crear receta en B.
  await req('POST', '/api/org/activa', { body: { id: orgB }, jar: admin });
  const recB = (await req('POST', '/api/store/est_recetas', { body: { nombre: 'Pan B', tipo: 'sub' }, jar: admin })).json;

  // Lectura scoped: con B activa solo se ven las recetas de B.
  let recs = (await req('GET', '/api/store/est_recetas', { jar: admin })).json;
  ok('GET solo devuelve recetas de la organización activa (B)',
    recs.length === 1 && recs[0].id === recB.id, 'ids=' + recs.map(r => r.id));

  // Las versiones (contenido de la fórmula) también quedan aisladas.
  let vers = (await req('GET', '/api/store/est_versiones', { jar: admin })).json;
  ok('GET est_versiones aislado por organización (no filtra la de A)',
    vers.every(v => v.recetaId !== recA.id), 'vers=' + vers.map(v => v.recetaId));

  // ?all=1 (solo admin) devuelve todo, para respaldos.
  let todas = (await req('GET', '/api/store/est_recetas?all=1', { jar: admin })).json;
  ok('GET ?all=1 (admin) devuelve todas las organizaciones', todas.length === 2, 'n=' + todas.length);

  // El viewer NO puede usar ?all=1 para saltarse el aislamiento.
  await req('POST', '/api/org/activa', { body: { id: orgB }, jar: viewer });
  let verAll = (await req('GET', '/api/store/est_recetas?all=1', { jar: viewer })).json;
  ok('viewer con ?all=1 sigue limitado a la organización activa', verAll.length === 1, 'n=' + verAll.length);

  // Editar una receta de OTRA organización (A) con B activa → bloqueado.
  let put = await req('PUT', '/api/store/est_recetas/' + recA.id, { body: { nombre: 'Hackeada' }, jar: admin });
  ok('PUT sobre datos de otra organización → 403', put.status === 403, 'status=' + put.status);
  let del = await req('DELETE', '/api/store/est_recetas/' + recA.id, { jar: admin });
  ok('DELETE sobre datos de otra organización → 403', del.status === 403, 'status=' + del.status);

  // Transferencia BLOQUEADA por confidencialidad (recA es 'interna' por defecto).
  let tr = await req('POST', '/api/org/transferir-receta', { body: { recetaId: recA.id, destinoOrgId: orgB }, jar: admin });
  ok('Transferir una receta interna → 403 (servidor aplica la confidencialidad)', tr.status === 403, 'status=' + tr.status);

  // Marcar recA como 'transferible' (con A activa) y transferir a B → permitido.
  await req('POST', '/api/org/activa', { body: { id: orgA }, jar: admin });
  await req('PUT', '/api/store/est_recetas/' + recA.id, { body: { nombre: 'Pan A', tipo: 'sub', organizacion: orgA, confidencialidad: 'transferible' }, jar: admin });
  let tr2 = await req('POST', '/api/org/transferir-receta', { body: { recetaId: recA.id, destinoOrgId: orgB, autorizadoPor: 'Alvaro' }, jar: admin });
  ok('Transferir una receta transferible → 201', tr2.status === 201, 'status=' + tr2.status);
  ok('La transferencia copió la versión', tr2.json && tr2.json.versiones === 1, 'versiones=' + (tr2.json && tr2.json.versiones));

  // La copia vive en B, como 'interna', con trazabilidad.
  let recsB = (await req('GET', '/api/store/est_recetas?all=1', { jar: admin })).json.filter(r => r.transferidaDe);
  ok('La copia queda como interna en el destino con trazabilidad',
    recsB.length === 1 && recsB[0].organizacion === orgB && recsB[0].confidencialidad === 'interna' && recsB[0].transferidaDe.recetaId === recA.id,
    JSON.stringify(recsB[0] && { org: recsB[0].organizacion, conf: recsB[0].confidencialidad }));

  // Quedó registro en est_exportaciones y en est_accesos.
  let exps = (await req('GET', '/api/store/est_exportaciones', { jar: admin })).json;
  ok('La transferencia se registró en el historial de exportaciones',
    exps.some(e => e.destino === 'transferencia' && e.autorizadoPor === 'Alvaro'));
  let accesos = (await req('GET', '/api/store/est_accesos', { jar: admin })).json;
  ok('El servidor registró accesos (activaciones, denegados, transferencia)',
    accesos.some(a => a.accion === 'org.acceso_denegado') &&
    accesos.some(a => a.accion === 'org.transferencia') &&
    accesos.some(a => a.accion === 'org.transferencia_denegada'),
    'acciones=' + [...new Set(accesos.map(a => a.accion))].join(','));

  // Un viewer no puede escribir (requireAdmin sigue vigente).
  let vpost = await req('POST', '/api/store/est_recetas', { body: { nombre: 'X', tipo: 'sub' }, jar: viewer });
  ok('viewer no puede crear (403)', vpost.status === 403, 'status=' + vpost.status);
};
