// ════════════════════════════════════════════════════════════════
// PAN CONTROL — PRODUCCIÓN Y ESTANDARIZACIÓN — CAPA DE INTERFAZ
// Requiere: app.js (helpers dbAll/dbAdd/dbPut/dbDel, escHtml, toast…)
// y produccion-core.js (EstCore: lógica pura de dominio).
// Los datos de este módulo viven en IndexedDB local (stores est_*).
// No se sincronizan con Firestore en esta fase (decisión conservadora:
// el sync existente hace espejo con borrado y podría eliminar datos).
// ════════════════════════════════════════════════════════════════
'use strict';

const EST_STORES=['est_ingredientes','est_productos','est_recetas','est_versiones','est_ordenes','est_lotes','est_auditoria','est_organizaciones','est_exportaciones','est_accesos'];
const EST_OPERACIONES=['Pesado','Mezclado','Amasado','Reposo','Fermentación','Laminado','División','Formado','Rellenado','Horneado','Enfriado','Decoración','Empacado'];
const EST_CRITERIOS_CALIDAD=['Peso','Tamaño','Color','Aroma','Sabor','Textura','Cocción','Presentación','Sellado','Empaque'];

// ── Permisos: se validan en la capa de datos, no solo en botones ──
function estRol(){return currentRole==='admin'?'admin':'viewer'}
function estGuard(accion){
  if(EstCore.puede(estRol(),accion))return true;
  toast('⛔ Tu rol no tiene permiso para esta acción','var(--red)');
  return false;
}
function estPuedeVer(accion){return EstCore.puede(estRol(),accion)}

// ── Auditoría ─────────────────────────────────────────────────────
async function estAudit(accion,entidad,entidadId,antes,despues,motivo){
  try{
    await dbAdd('est_auditoria',{
      fecha:new Date().toISOString(),usuario:estRol(),accion,entidad,
      entidadId:entidadId??null,
      antes:antes?JSON.parse(JSON.stringify(antes)):null,
      despues:despues?JSON.parse(JSON.stringify(despues)):null,
      motivo:motivo||null
    });
  }catch(e){console.error('auditoría',e)}
}

// ── Utilitarios ───────────────────────────────────────────────────
function estNum(id){const n=toNum(v(id));return n}
function estFmtPct(x,dp=1){return x==null?'—':EstCore.redondear(x,dp)+'%'}
function estFmt(base,unidad){return EstCore.fmtCantidad(base,unidad)}
function estBadge(estado){
  const map={borrador:['Borrador','var(--gray)'],en_prueba:['En prueba','var(--gold)'],aprobada:['Aprobada','var(--green)'],reemplazada:['Reemplazada','var(--blue)'],archivada:['Archivada','var(--gray)'],
    programada:['Programada','var(--blue)'],en_proceso:['En proceso','var(--gold)'],pausada:['Pausada','var(--orange)'],terminada:['Terminada','var(--green)'],cancelada:['Cancelada','var(--red)'],rechazada:['Rechazada','var(--red)'],
    pendiente:['Pendiente','var(--gold)'],aprobado:['Aprobado','var(--green)'],aprobado_obs:['Aprobado c/obs','var(--gold)'],retenido:['Retenido','var(--orange)'],
    desarrollo:['Desarrollo','var(--gray)'],prueba:['Prueba','var(--gold)'],suspendido:['Suspendido','var(--orange)'],descontinuado:['Descontinuado','var(--red)'],activo:['Activo','var(--green)'],inactivo:['Inactivo','var(--gray)']};
  const[lbl,color]=map[estado]||[estado||'—','var(--gray)'];
  return`<span class="est-badge" style="background:${color}">${escHtml(lbl)}</span>`;
}
function estUnidadesPracticas(ing){
  const base=ing.unidadBase||'g';
  const std=base==='g'?['g','kg']:base==='ml'?['ml','L']:['und','docena'];
  return[...std,...(ing.presentaciones||[]).map(p=>p.nombre)];
}
async function estSeq(store){const rows=await dbAll(store);return rows.length+1}

// caches por render (solo lectura, se recargan en cada vista)
let _estCache={};
async function estLoad(...stores){
  await estSyncOrgServidor();   // el servidor debe conocer la organización activa antes de leer
  const out={};
  await Promise.all(stores.map(async s=>{out[s]=await dbAll(s)}));
  _estCache={..._estCache,...out};
  return out;
}
// Sincroniza la organización activa (que el usuario eligió) con la sesión del
// servidor, para que el aislamiento por organización lo aplique el backend y no
// solo la interfaz. Idempotente y barata: solo llama cuando cambió.
let _estOrgSyncronizada=null;
async function estSyncOrgServidor(){
  if(!(_estCache.est_organizaciones||[]).length){
    try{_estCache.est_organizaciones=await dbAll('est_organizaciones')}catch(e){return}
  }
  const id=estOrgActiva();
  if(id==null||String(id)===String(_estOrgSyncronizada))return;
  try{await api('/api/org/activa',{method:'POST',body:{id}});_estOrgSyncronizada=id;}
  catch(e){console.error('sincronizar organización',e)}
}
// ── Organizaciones (propiedad de las recetas) ──────────────────
function estOrgs(){return(_estCache.est_organizaciones||[]).slice().sort((a,b)=>a.id-b.id)}
function estOrgDefault(){const o=estOrgs();return o.length?o[0].id:null}   // la más antigua
function estOrgNombre(id){const o=(_estCache.est_organizaciones||[]).find(x=>x.id===Number(id));return o?o.nombre:'—'}
function estOrgActiva(){
  const guardada=Number(localStorage.getItem('est_org_activa'))||null;
  const existe=(_estCache.est_organizaciones||[]).some(x=>x.id===guardada);
  return existe?guardada:estOrgDefault();
}
async function estSetOrgActiva(id){
  localStorage.setItem('est_org_activa',String(id));
  _estOrgSyncronizada=null;               // forzar re-sincronización con el servidor
  await estSyncOrgServidor();
  estRenderOrgBar();estRefrescarVistaActual();
}
function estEnOrgActiva(entidad){return EstCore.perteneceAOrg(entidad,estOrgActiva(),estOrgDefault())}

// ── Confidencialidad de recetas (control de exportación/transferencia) ──
function estNivelConf(receta){return EstCore.nivelConfidencial(receta)}
function estBadgeConf(nivel){
  const n=EstCore.normNivelConfidencial(nivel);
  const map={interna:['🔒 Interna','var(--blue)'],restringida:['⛔ Restringida','var(--red)'],
    plantilla:['📄 Plantilla','var(--green)'],transferible:['↗ Transferible','var(--gold)']};
  const[lbl,color]=map[n]||['🔒 Interna','var(--blue)'];
  return`<span class="est-badge" style="background:${color}">${escHtml(lbl)}</span>`;
}
// Registra una salida de información (a archivo o a otra organización) en el
// historial de exportaciones, además de la auditoría general.
async function estRegistrarExport({receta,version,formato,destino,orgDestino,autorizadoPor}){
  const reg={
    fecha:new Date().toISOString(),usuario:estRol(),
    recetaId:receta?receta.id:null,recetaNombre:receta?receta.nombre:'—',
    versionId:version?version.id:null,versionNumero:version?version.numero:null,
    nivel:EstCore.nivelConfidencial(receta),
    formato:formato||null,destino:destino||'archivo',
    organizacionOrigen:receta&&receta.organizacion!=null?receta.organizacion:estOrgActiva(),
    organizacionDestino:orgDestino!=null?orgDestino:null,
    autorizadoPor:autorizadoPor||null
  };
  try{
    await dbAdd('est_exportaciones',reg);
    await estAudit(destino==='transferencia'?'receta.transferir':'receta.exportar',
      'est_recetas',reg.recetaId,null,reg);
  }catch(e){console.error('registro de exportación',e)}
}
// Crea la organización por defecto la primera vez (no rompe datos previos).
// Candado contra condición de carrera: si varias vistas la invocan casi a la
// vez, todas esperan la MISMA creación en lugar de crear duplicados.
let _estBootstrapPromise=null;
async function estBootstrapOrgs(){
  if((_estCache.est_organizaciones||[]).length)return;
  if(_estBootstrapPromise)return _estBootstrapPromise;
  _estBootstrapPromise=(async()=>{
    await estLoad('est_organizaciones');                 // re-verifica con datos frescos
    if(!(_estCache.est_organizaciones||[]).length){
      const id=await dbAdd('est_organizaciones',{nombre:'Mi organización',createdAt:new Date().toISOString()});
      await estLoad('est_organizaciones');
      if(!localStorage.getItem('est_org_activa'))localStorage.setItem('est_org_activa',String(id));
    }
  })();
  try{await _estBootstrapPromise;}finally{_estBootstrapPromise=null;}
}
function estRefrescarVistaActual(){
  // Re-renderiza la pestaña visible tras cambiar de organización.
  const activa=document.querySelector('#page-estandarizacion .tab.active')?.dataset.tab;
  ({panel:estRenderPanel,ing:estRenderIngredientes,prod:estRenderProductos,rec:estRenderRecetas,calc:estRenderCalc,ord:estRenderOrdenes}[activa]||(()=>{}))();
}
function estRenderOrgBar(){
  const el=document.getElementById('est-orgbar');if(!el)return;
  const orgs=estOrgs();const activa=estOrgActiva();const puede=estPuedeVer('config');
  el.innerHTML=`
  <div class="est-orgbar">
    <div class="est-org-row">
      <span class="est-org-lbl">🏢 Organización:</span>
      <select class="est-org-sel" onchange="estSetOrgActiva(this.value)">
        ${orgs.map(o=>`<option value="${o.id}"${o.id===activa?' selected':''}>${escHtml(o.nombre)}</option>`).join('')||'<option>—</option>'}
      </select>
      ${puede?`<button class="btn bsec bsm est-admin-only" onclick="estCrearOrg()">＋ Nueva</button>
      <button class="btn bsec bsm est-admin-only" onclick="estRenombrarOrg()">✏ Renombrar</button>`:''}
    </div>
    <div class="est-org-warn">⚠ Registra, exporta o reutiliza únicamente fórmulas y procesos cuya documentación estés autorizado a usar. Cada receta pertenece a la organización seleccionada.</div>
  </div>`;
}
async function estCrearOrg(){
  if(!estGuard('config'))return;
  const nombre=prompt('Nombre de la nueva organización (ej.: Casa Milagro):');
  if(nombre==null)return;
  const n=nombre.trim();if(!n)return toast('⚠ Escribe un nombre','var(--red)');
  if(estOrgs().some(o=>o.nombre.toLowerCase()===n.toLowerCase()))return toast('⚠ Ya existe una organización con ese nombre','var(--gold)');
  const id=await dbAdd('est_organizaciones',{nombre:n,createdAt:new Date().toISOString()});
  await estAudit('org.crear','est_organizaciones',id,null,{nombre:n});
  await estLoad('est_organizaciones');
  localStorage.setItem('est_org_activa',String(id));
  estRenderOrgBar();estRefrescarVistaActual();
  toast('🏢 Organización creada: '+n);
}
async function estRenombrarOrg(){
  if(!estGuard('config'))return;
  const id=estOrgActiva();const actual=estOrgNombre(id);
  const nombre=prompt('Nuevo nombre para la organización:',actual);
  if(nombre==null)return;
  const n=nombre.trim();if(!n)return toast('⚠ Escribe un nombre','var(--red)');
  const org=(_estCache.est_organizaciones||[]).find(x=>x.id===Number(id));if(!org)return;
  await dbPut('est_organizaciones',{...org,nombre:n});
  await estAudit('org.renombrar','est_organizaciones',id,{nombre:actual},{nombre:n});
  await estLoad('est_organizaciones');
  estRenderOrgBar();estRefrescarVistaActual();
  toast('✅ Organización renombrada');
}
function estIng(id){return(_estCache.est_ingredientes||[]).find(x=>x.id===id)}
function estProd(id){return(_estCache.est_productos||[]).find(x=>x.id===id)}
function estRec(id){return(_estCache.est_recetas||[]).find(x=>x.id===id)}
function estVersionesDe(recetaId){return(_estCache.est_versiones||[]).filter(x=>x.recetaId===recetaId).sort((a,b)=>b.numero-a.numero)}
function estVersionVigente(recetaId){
  const vs=estVersionesDe(recetaId);
  return vs.find(x=>x.estado==='aprobada')||vs[0]||null;
}
// resolver para expansión de subrecetas: usa la versión aprobada (o la última)
function estResolver(recetaId){
  const receta=estRec(recetaId);
  const version=estVersionVigente(recetaId);
  return receta&&version?{receta,version}:null;
}
function estResolverComponentes(recetaId){
  const r=estResolver(recetaId);
  return r&&r.version?(r.version.componentes||[]):[];
}

// ════════════════════════════════════════════════════════════════
// PANEL
// ════════════════════════════════════════════════════════════════
async function estRenderPanel(){
  const el=document.getElementById('est-panel');if(!el)return;
  await estLoad(...EST_STORES);
  await estBootstrapOrgs();
  estRenderOrgBar();
  const ords=_estCache.est_ordenes||[],lotes=_estCache.est_lotes||[],vers=_estCache.est_versiones||[];
  const term=ords.filter(o=>o.estado==='terminada');
  const rends=term.map(o=>o.kpis&&o.kpis.rendimientoPct).filter(x=>x!=null);
  const mermas=term.map(o=>o.kpis&&o.kpis.mermaPct).filter(x=>x!=null);
  const prom=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const desv=term.filter(o=>o.kpis).map(o=>({nombre:(o.snapshot&&o.snapshot.producto&&o.snapshot.producto.nombre)||o.codigo,d:Math.abs(o.kpis.desviacionUnidades||0)})).sort((a,b)=>b.d-a.d).slice(0,5);
  const ultimas=[...vers].sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt))).slice(0,5);
  const stat=(lbl,val,color)=>`<div class="est-stat"><div class="est-stat-v" style="color:${color||'var(--brown)'}">${val}</div><div class="est-stat-l">${lbl}</div></div>`;
  el.innerHTML=`
  <div class="est-stats">
    ${stat('Órdenes pendientes',ords.filter(o=>['borrador','programada'].includes(o.estado)).length,'var(--blue)')}
    ${stat('En proceso',ords.filter(o=>['en_proceso','pausada'].includes(o.estado)).length,'var(--gold)')}
    ${stat('Terminadas',term.length,'var(--green)')}
    ${stat('Rendimiento prom.',estFmtPct(prom(rends)),'var(--green)')}
    ${stat('Merma prom.',estFmtPct(prom(mermas)),'var(--orange)')}
    ${stat('Lotes retenidos/rechazados',lotes.filter(l=>['retenido','rechazado'].includes(l.estado)).length,'var(--red)')}
  </div>
  <div class="card"><div class="card-title">📈 Productos con mayor desviación (|plan − real|)</div>
    <div class="table-wrap"><table><thead><tr><th>Producto / orden</th><th>Desviación (und)</th></tr></thead><tbody>
    ${desv.length?desv.map(x=>`<tr><td>${escHtml(x.nombre)}</td><td>${x.d}</td></tr>`).join(''):empty(2)}</tbody></table></div></div>
  <div class="card"><div class="card-title">📝 Últimas recetas modificadas</div>
    <div class="table-wrap"><table><thead><tr><th>Receta</th><th>Versión</th><th>Estado</th><th>Actualizada</th></tr></thead><tbody>
    ${ultimas.length?ultimas.map(vr=>{const r=estRec(vr.recetaId);return`<tr><td>${escHtml(r?r.nombre:'—')}</td><td>v${vr.numero}</td><td>${estBadge(vr.estado)}</td><td>${escHtml(String(vr.updatedAt||vr.createdAt||'').slice(0,10))}</td></tr>`}).join(''):empty(4)}</tbody></table></div></div>
  ${estPuedeVer('auditoria.ver')?`<div class="card"><div class="card-title">🕓 Auditoría reciente</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Motivo</th></tr></thead><tbody>
    ${(_estCache.est_auditoria||[]).slice(-15).reverse().map(a=>`<tr><td>${escHtml(String(a.fecha).slice(0,16).replace('T',' '))}</td><td>${escHtml(a.usuario)}</td><td>${escHtml(a.accion)}</td><td>${escHtml(a.entidad)} #${a.entidadId??''}</td><td>${escHtml(a.motivo||'')}</td></tr>`).join('')||empty(5)}</tbody></table></div></div>`:''}
  <div class="card est-admin-only"><div class="card-title">🧰 Herramientas del módulo</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn bgold" onclick="estCargarDemo()">🧪 Cargar datos de demostración (ficticios)</button>
      <button class="btn bg2" onclick="estExportarModulo()">💾 Descargar respaldo del módulo (JSON)</button>
      <button class="btn bb" onclick="document.getElementById('est-import-file').click()">📂 Restaurar respaldo del módulo</button>
      <input type="file" id="est-import-file" accept=".json" style="display:none" onchange="estImportarModulo(this)">
      <div style="font-size:.75rem;color:var(--gray)">Los datos de demostración están marcados como [DEMO] y son ficticios: no representan fórmulas reales de la panadería. Los datos de este módulo se guardan en este dispositivo; descarga respaldos con regularidad.</div>
    </div></div>`;
}

// ════════════════════════════════════════════════════════════════
// INGREDIENTES
// ════════════════════════════════════════════════════════════════
let _estIngEdit=null,_estIngPres=[];
async function estRenderIngredientes(){
  const el=document.getElementById('est-ing');if(!el)return;
  await estLoad('est_ingredientes','est_versiones');
  const rows=(_estCache.est_ingredientes||[]).sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre)));
  el.innerHTML=`
  <div class="card form-card">
    <div class="card-title" id="est-ing-form-title">Nuevo ingrediente / insumo</div>
    <div class="fgrid">
      <div class="fg"><label>Código</label><input type="text" id="ei-codigo" placeholder="Automático si se deja vacío"></div>
      <div class="fg"><label>Nombre *</label><input type="text" id="ei-nombre" placeholder="Ej.: Harina de trigo"></div>
      <div class="fg"><label>Categoría</label><input type="text" id="ei-cat" placeholder="Harinas, lácteos, empaque..."></div>
      <div class="fg"><label>Unidad base *</label><select id="ei-ub"><option value="g">Gramos (masa)</option><option value="ml">Mililitros (volumen)</option><option value="und">Unidades (conteo)</option></select></div>
      <div class="fg"><label>Proveedor / marca recomendada</label><input type="text" id="ei-prov" placeholder="Opcional"></div>
      <div class="fg"><label>Costo referencial (S/. por unidad base)</label><input type="number" id="ei-costo" min="0" step="0.000001" placeholder="Opcional"></div>
      <div class="fg"><label>Alérgenos</label><input type="text" id="ei-alerg" placeholder="Gluten, lácteos... (opcional)"></div>
      <div class="fg"><label>Estado</label><select id="ei-estado"><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></div>
      <div class="fg fgrid one"><label>Observaciones</label><input type="text" id="ei-obs" placeholder="Opcional"></div>
    </div>
    <div style="font-size:.75rem;font-weight:700;color:var(--brown2);margin:4px 0 8px;text-transform:uppercase">Presentaciones de compra (equivalencias configurables):</div>
    <div id="ei-pres-lineas"></div>
    <button class="btn bsec bsm add-line-btn" onclick="estAddPres()" style="margin-bottom:12px">＋ Agregar presentación</button>
    <div style="display:flex;gap:8px">
      <button class="btn bp" style="flex:1;justify-content:center" onclick="estGuardarIngrediente()">💾 Guardar ingrediente</button>
      <button class="btn bsec" id="ei-cancel" style="display:none" onclick="estCancelarIng()">Cancelar edición</button>
    </div>
  </div>
  <div class="card"><div class="card-title">Catálogo técnico de ingredientes (${rows.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Nombre</th><th>Categoría</th><th>U. base</th><th>Presentaciones</th><th>Alérgenos</th><th>Estado</th><th>✏️</th><th>🗑</th></tr></thead><tbody>
    ${rows.length?rows.map(r=>`<tr>
      <td>${escHtml(r.codigo)}</td><td><b>${escHtml(r.nombre)}</b>${r.demo?' <span class="est-demo">DEMO</span>':''}</td>
      <td>${escHtml(r.categoria||'')}</td><td>${r.unidadBase}</td>
      <td>${(r.presentaciones||[]).map(p=>escHtml(p.nombre)+' = '+estFmt(p.factorBase,r.unidadBase)).join('<br>')||'—'}</td>
      <td>${escHtml(r.alergenos||'—')}</td><td>${estBadge(r.estado)}</td>
      <td><button class="edit-btn" onclick="estEditarIng(${r.id})">✏️</button></td>
      <td><button class="del-btn" onclick="estBorrarIng(${r.id})">🗑</button></td></tr>`).join(''):empty(9)}
    </tbody></table></div></div>`;
  _estIngPres=[];_estIngEdit=null;estRenderPresLineas('g');
}
function estRenderPresLineas(ub){
  const cont=document.getElementById('ei-pres-lineas');if(!cont)return;
  const unidad=ub||v('ei-ub')||'g';
  const uLbl=unidad==='g'?['kg','g']:unidad==='ml'?['L','ml']:['und'];
  cont.innerHTML=_estIngPres.map((p,i)=>`
    <div class="fgrid three" style="margin-bottom:6px">
      <div class="fg"><input type="text" value="${escAttr(p.nombre)}" placeholder="Ej.: Saco proveedor A" oninput="_estIngPres[${i}].nombre=this.value"></div>
      <div class="fg"><input type="number" min="0" step="any" value="${escAttr(p.cant)}" placeholder="Equivale a..." oninput="_estIngPres[${i}].cant=this.value"></div>
      <div class="fg" style="display:flex;gap:6px"><select onchange="_estIngPres[${i}].unidad=this.value" style="flex:1">${uLbl.map(u=>`<option${p.unidad===u?' selected':''}>${u}</option>`).join('')}</select>
      <button class="del-btn" onclick="_estIngPres.splice(${i},1);estRenderPresLineas()">🗑</button></div>
    </div>`).join('')||'<div style="font-size:.78rem;color:var(--gray);margin-bottom:8px">Sin presentaciones. Ejemplo: "Saco proveedor A" = 40 kg. Cada presentación tiene su propia equivalencia: nunca se asume que un saco pesa siempre lo mismo.</div>';
}
function estAddPres(){
  const ub=v('ei-ub')||'g';
  _estIngPres.push({nombre:'',cant:'',unidad:ub==='g'?'kg':ub==='ml'?'L':'und'});
  estRenderPresLineas(ub);
}
async function estGuardarIngrediente(){
  if(!estGuard('ing.crud'))return;
  const nombre=v('ei-nombre').trim();
  if(!nombre)return toast('⚠ El nombre es obligatorio','var(--red)');
  if(nombre.length>120)return toast('⚠ Nombre demasiado largo','var(--red)');
  const ub=v('ei-ub');
  const presentaciones=[];
  for(const p of _estIngPres){
    if(!String(p.nombre).trim())continue;
    const conv=EstCore.aBase(toNum(p.cant),p.unidad,ub);
    if(!conv.ok||!(conv.cantidadBase>0))return toast(`⚠ Presentación "${p.nombre}": equivalencia inválida`,'var(--red)');
    presentaciones.push({nombre:String(p.nombre).trim(),factorBase:conv.cantidadBase});
  }
  const ahora=new Date().toISOString();
  const rec={
    codigo:v('ei-codigo').trim()||EstCore.genCodigo('ING',await estSeq('est_ingredientes')),
    nombre,categoria:v('ei-cat').trim(),unidadBase:ub,presentaciones,
    proveedor:v('ei-prov').trim(),costoRef:toNum(v('ei-costo'))||null,
    alergenos:v('ei-alerg').trim(),estado:v('ei-estado'),obs:v('ei-obs').trim(),updatedAt:ahora
  };
  if(_estIngEdit){
    const antes=estIng(_estIngEdit);
    await dbPut('est_ingredientes',{...antes,...rec,id:_estIngEdit});
    await estAudit('ingrediente.editar','est_ingredientes',_estIngEdit,antes,rec);
    toast('✅ Ingrediente actualizado');
  }else{
    rec.createdAt=ahora;
    const id=await dbAdd('est_ingredientes',rec);
    await estAudit('ingrediente.crear','est_ingredientes',id,null,rec);
    toast('✅ Ingrediente creado');
  }
  estRenderIngredientes();
}
function estCancelarIng(){estRenderIngredientes()}
function estEditarIng(id){
  if(!estGuard('ing.crud'))return;
  const r=estIng(id);if(!r)return;
  _estIngEdit=id;
  document.getElementById('est-ing-form-title').textContent='Editando: '+r.nombre;
  document.getElementById('ei-cancel').style.display='';
  ['codigo','nombre','cat','prov','costo','alerg','obs'].forEach(k=>{
    const map={codigo:'codigo',nombre:'nombre',cat:'categoria',prov:'proveedor',costo:'costoRef',alerg:'alergenos',obs:'obs'};
    const el=document.getElementById('ei-'+k);if(el)el.value=r[map[k]]??'';
  });
  document.getElementById('ei-ub').value=r.unidadBase;
  document.getElementById('ei-estado').value=r.estado||'activo';
  _estIngPres=(r.presentaciones||[]).map(p=>{
    const u=r.unidadBase==='g'?'kg':r.unidadBase==='ml'?'L':'und';
    return{nombre:p.nombre,cant:EstCore.deBase(p.factorBase,u,r.unidadBase).cantidad,unidad:u};
  });
  estRenderPresLineas(r.unidadBase);
  window.scrollTo(0,0);document.getElementById('main').scrollTop=0;
}
async function estBorrarIng(id){
  if(!estGuard('ing.crud'))return;
  const usado=(_estCache.est_versiones||[]).some(vr=>(vr.componentes||[]).some(c=>c.tipo==='ing'&&c.refId===id));
  if(usado)return toast('⛔ Está usado en recetas. Márcalo como inactivo en lugar de borrarlo.','var(--red)');
  const r=estIng(id);
  if(!confirm(`¿Eliminar el ingrediente "${r?r.nombre:id}"? Esta acción no se puede deshacer.`))return;
  await dbDel('est_ingredientes',id);
  await estAudit('ingrediente.eliminar','est_ingredientes',id,r,null);
  toast('🗑 Ingrediente eliminado');estRenderIngredientes();
}

// ════════════════════════════════════════════════════════════════
// PRODUCTOS ELABORADOS
// ════════════════════════════════════════════════════════════════
let _estProdEdit=null;
async function estRenderProductos(){
  const el=document.getElementById('est-prod');if(!el)return;
  await estLoad('est_productos','est_recetas','est_organizaciones');
  await estBootstrapOrgs();estRenderOrgBar();
  const rows=(_estCache.est_productos||[]).filter(estEnOrgActiva).sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre)));
  el.innerHTML=`
  <div class="card form-card">
    <div class="card-title" id="est-prod-form-title">Nuevo producto elaborado</div>
    <div class="fgrid">
      <div class="fg"><label>Código</label><input type="text" id="ep-codigo" placeholder="Automático si se deja vacío"></div>
      <div class="fg"><label>Nombre *</label><input type="text" id="ep-nombre" placeholder="Ej.: Empanada de queso"></div>
      <div class="fg"><label>Categoría</label><input type="text" id="ep-cat" placeholder="Pan, pastel, empanada..."></div>
      <div class="fg"><label>Unidad de venta</label><input type="text" id="ep-uv" placeholder="unidad, porción..."></div>
      <div class="fg"><label>Peso objetivo antes de horno (g)</label><input type="number" id="ep-pesoAntes" min="0" step="any"></div>
      <div class="fg"><label>Peso objetivo después de horno (g)</label><input type="number" id="ep-pesoDespues" min="0" step="any"></div>
      <div class="fg"><label>Tolerancia mínima (g)</label><input type="number" id="ep-tolMin" min="0" step="any"></div>
      <div class="fg"><label>Tolerancia máxima (g)</label><input type="number" id="ep-tolMax" min="0" step="any"></div>
      <div class="fg"><label>Dimensiones (largo×ancho×alto o diámetro)</label><input type="text" id="ep-dim" placeholder="Opcional"></div>
      <div class="fg"><label>Vida útil (días)</label><input type="number" id="ep-vida" min="0" step="1"></div>
      <div class="fg"><label>Unidades por bandeja</label><input type="number" id="ep-bandeja" min="0" step="1"></div>
      <div class="fg"><label>Unidades por lote/tanda</label><input type="number" id="ep-lote" min="0" step="1"></div>
      <div class="fg"><label>Muestra recomendada (unidades a pesar)</label><input type="number" id="ep-muestra" min="0" step="1" placeholder="Ej.: 5"></div>
      <div class="fg"><label>Estado</label><select id="ep-estado">${EstCore.ESTADOS_PRODUCTO.map(e=>`<option value="${e}">${e[0].toUpperCase()+e.slice(1)}</option>`).join('')}</select></div>
      <div class="fg fgrid one"><label>Condiciones de conservación</label><input type="text" id="ep-cons" placeholder="Ambiente fresco, refrigerado..."></div>
      <div class="fg fgrid one"><label>Descripción</label><input type="text" id="ep-desc" placeholder="Opcional"></div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn bp" style="flex:1;justify-content:center" onclick="estGuardarProducto()">💾 Guardar producto</button>
      <button class="btn bsec" id="ep-cancel" style="display:none" onclick="estRenderProductos()">Cancelar</button>
    </div>
  </div>
  <div class="card"><div class="card-title">Productos de ${escHtml(estOrgNombre(estOrgActiva()))} (${rows.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Nombre</th><th>Categoría</th><th>Peso obj. (g)</th><th>Tolerancia (g)</th><th>Bandeja</th><th>Estado</th><th>✏️</th><th>🗑</th></tr></thead><tbody>
    ${rows.length?rows.map(r=>`<tr>
      <td>${escHtml(r.codigo)}</td><td><b>${escHtml(r.nombre)}</b>${r.demo?' <span class="est-demo">DEMO</span>':''}</td>
      <td>${escHtml(r.categoria||'')}</td><td>${r.pesoDespues||r.pesoAntes||'—'}</td>
      <td>${r.tolMin||'—'} – ${r.tolMax||'—'}</td><td>${r.porBandeja||'—'}</td><td>${estBadge(r.estado)}</td>
      <td><button class="edit-btn" onclick="estEditarProd(${r.id})">✏️</button></td>
      <td><button class="del-btn" onclick="estBorrarProd(${r.id})">🗑</button></td></tr>`).join(''):empty(9)}
    </tbody></table></div></div>`;
  _estProdEdit=null;
}
async function estGuardarProducto(){
  if(!estGuard('prod.crud'))return;
  const nombre=v('ep-nombre').trim();
  if(!nombre)return toast('⚠ El nombre es obligatorio','var(--red)');
  const tolMin=toNum(v('ep-tolMin')),tolMax=toNum(v('ep-tolMax'));
  if(tolMin&&tolMax&&tolMin>tolMax)return toast('⚠ La tolerancia mínima no puede superar la máxima','var(--red)');
  const ahora=new Date().toISOString();
  const rec={
    codigo:v('ep-codigo').trim()||EstCore.genCodigo('PRD',await estSeq('est_productos')),
    nombre,categoria:v('ep-cat').trim(),descripcion:v('ep-desc').trim(),
    pesoAntes:toNum(v('ep-pesoAntes'))||null,pesoDespues:toNum(v('ep-pesoDespues'))||null,
    tolMin:tolMin||null,tolMax:tolMax||null,dimensiones:v('ep-dim').trim(),
    unidadVenta:v('ep-uv').trim()||'unidad',vidaUtilDias:toNum(v('ep-vida'))||null,
    conservacion:v('ep-cons').trim(),porBandeja:toNum(v('ep-bandeja'))||null,
    porLote:toNum(v('ep-lote'))||null,muestraRecomendada:toNum(v('ep-muestra'))||null,
    estado:v('ep-estado'),updatedAt:ahora
  };
  if(_estProdEdit){
    const antes=estProd(_estProdEdit);
    await dbPut('est_productos',{...antes,...rec,id:_estProdEdit});
    await estAudit('producto.editar','est_productos',_estProdEdit,antes,rec);
    toast('✅ Producto actualizado');
  }else{
    rec.createdAt=ahora;
    rec.organizacion=estOrgActiva();       // pertenece a la organización activa
    const id=await dbAdd('est_productos',rec);
    await estAudit('producto.crear','est_productos',id,null,rec);
    toast('✅ Producto creado');
  }
  estRenderProductos();
}
function estEditarProd(id){
  if(!estGuard('prod.crud'))return;
  const r=estProd(id);if(!r)return;
  _estProdEdit=id;
  document.getElementById('est-prod-form-title').textContent='Editando: '+r.nombre;
  document.getElementById('ep-cancel').style.display='';
  const map={codigo:'codigo',nombre:'nombre',cat:'categoria',uv:'unidadVenta',pesoAntes:'pesoAntes',pesoDespues:'pesoDespues',tolMin:'tolMin',tolMax:'tolMax',dim:'dimensiones',vida:'vidaUtilDias',bandeja:'porBandeja',lote:'porLote',muestra:'muestraRecomendada',cons:'conservacion',desc:'descripcion'};
  Object.entries(map).forEach(([k,f])=>{const el=document.getElementById('ep-'+k);if(el)el.value=r[f]??''});
  document.getElementById('ep-estado').value=r.estado||'desarrollo';
  window.scrollTo(0,0);document.getElementById('main').scrollTop=0;
}
async function estBorrarProd(id){
  if(!estGuard('prod.crud'))return;
  const conReceta=(_estCache.est_recetas||[]).some(r=>r.productoId===id);
  if(conReceta)return toast('⛔ Tiene recetas asociadas. Márcalo como descontinuado en lugar de borrarlo.','var(--red)');
  const r=estProd(id);
  if(!confirm(`¿Eliminar el producto "${r?r.nombre:id}"?`))return;
  await dbDel('est_productos',id);
  await estAudit('producto.eliminar','est_productos',id,r,null);
  toast('🗑 Producto eliminado');estRenderProductos();
}

// ════════════════════════════════════════════════════════════════
// RECETAS, VERSIONES, SUBRECETAS Y PASOS
// ════════════════════════════════════════════════════════════════
let estEd=null; // estado del editor: {recetaId, versionId, comps:[], pasos:[]}
async function estRenderRecetas(){
  const el=document.getElementById('est-rec');if(!el)return;
  await estLoad('est_recetas','est_versiones','est_productos','est_ingredientes','est_organizaciones','est_exportaciones','est_accesos');
  await estBootstrapOrgs();estRenderOrgBar();
  const recetas=(_estCache.est_recetas||[]).filter(estEnOrgActiva).sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre)));
  const prods=(_estCache.est_productos||[]);
  el.innerHTML=`
  <div class="card form-card">
    <div class="card-title">Nueva receta maestra</div>
    <div class="fgrid">
      <div class="fg"><label>Tipo</label><select id="er-tipo" onchange="document.getElementById('er-prod-wrap').style.display=this.value==='producto'?'':'none';document.getElementById('er-nombre-wrap').style.display=this.value==='producto'?'none':''">
        <option value="producto">Receta de producto final</option><option value="sub">Subreceta / preparación (masa, relleno...)</option></select></div>
      <div class="fg" id="er-prod-wrap"><label>Producto</label><select id="er-producto">${prods.map(p=>`<option value="${p.id}">${escHtml(p.nombre)}</option>`).join('')||'<option value="">— Crea primero un producto —</option>'}</select></div>
      <div class="fg" id="er-nombre-wrap" style="display:none"><label>Nombre de la subreceta</label><input type="text" id="er-nombre" placeholder="Ej.: Masa base"></div>
      <div class="fg"><label>Responsable</label><input type="text" id="er-resp" placeholder="Ej.: María"></div>
    </div>
    <button class="btn bp btn-full" onclick="estCrearReceta()">➕ Crear receta (versión 1 en borrador)</button>
  </div>
  <div class="card"><div class="card-title">Recetas de ${escHtml(estOrgNombre(estOrgActiva()))} (${recetas.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Receta</th><th>Confid.</th><th>Tipo</th><th>Versiones</th></tr></thead><tbody>
    ${recetas.length?recetas.map(r=>{
      const vs=estVersionesDe(r.id);
      return`<tr><td><b>${escHtml(r.nombre)}</b>${r.demo?' <span class="est-demo">DEMO</span>':''}${r.transferidaDe?' <span class="est-badge" style="background:var(--gray)">↙ recibida</span>':''}</td>
      <td>${estBadgeConf(EstCore.nivelConfidencial(r))}</td>
      <td>${r.tipo==='sub'?'🥣 Subreceta':'🥖 Producto'}</td>
      <td>${vs.map(vr=>`<button class="btn bsec bsm" style="margin:2px" onclick="estAbrirVersion(${vr.id})">v${vr.numero} ${estBadge(vr.estado)}</button>`).join('')||'—'}</td></tr>`;
    }).join(''):empty(4)}</tbody></table></div></div>
  ${(()=>{const comp=recetas.filter(r=>estVersionesDe(r.id).length>=2);return `
  <div class="card">
    <div class="card-title">🔍 Comparar versiones</div>
    ${comp.length?`
    <div class="fgrid">
      <div class="fg"><label>Receta</label><select id="ec-rec" onchange="estCompLlenarVersiones()"><option value="">Selecciona...</option>${comp.map(r=>`<option value="${r.id}">${escHtml(r.nombre)}</option>`).join('')}</select></div>
      <div class="fg"><label>Versión A (anterior)</label><select id="ec-va"></select></div>
      <div class="fg"><label>Versión B (nueva)</label><select id="ec-vb"></select></div>
    </div>
    <button class="btn bb btn-full" onclick="estCompararRender()">⇄ Comparar</button>
    <div id="ec-result" style="margin-top:12px"></div>`
    :'<div class="est-aviso">Aún no hay recetas con 2 o más versiones. Crea una nueva versión desde una receta (botón "Crear nueva versión") para poder comparar.</div>'}
  </div>`;})()}
  ${estHistorialExportHTML()}
  ${estHistorialAccesosHTML()}
  <div id="est-rec-editor"></div>`;
}
// Historial de accesos / seguridad (solo admin). Muestra los eventos que el
// SERVIDOR registró: cambios de organización activa, intentos bloqueados de
// tocar datos de otra organización y transferencias.
function estHistorialAccesosHTML(){
  if(!estPuedeVer('config'))return '';
  const org=estOrgActiva();
  const lbl={
    'org.activar':['🔄 Organización activada','var(--blue)'],
    'org.acceso_denegado':['⛔ Acceso a otra organización BLOQUEADO','var(--red)'],
    'org.escritura_cruzada':['↗ Escritura en otra organización','var(--gold)'],
    'org.transferencia':['↗ Transferencia de receta','var(--green)'],
    'org.transferencia_denegada':['⛔ Transferencia BLOQUEADA','var(--red)']
  };
  const regs=(_estCache.est_accesos||[])
    .filter(x=>String(x.organizacion)===String(org)||(x.detalle&&String(x.detalle.organizacionDestino)===String(org)))
    .sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0,50);
  return`
  <div class="card est-admin-only">
    <div class="card-title">🛡️ Historial de accesos y seguridad</div>
    ${regs.length?`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Evento</th></tr></thead><tbody>
    ${regs.map(x=>{const[t,c]=lbl[x.accion]||[x.accion,'var(--gray)'];return`<tr>
      <td>${escHtml(String(x.fecha||'').slice(0,16).replace('T',' '))}</td>
      <td>${escHtml(x.usuario||'—')}${x.rol?` <span class="est-badge" style="background:var(--gray)">${escHtml(x.rol)}</span>`:''}</td>
      <td><span class="est-badge" style="background:${c}">${escHtml(t)}</span></td></tr>`;}).join('')}
    </tbody></table></div>`
    :'<div class="est-aviso">El servidor registrará aquí los cambios de organización y cualquier intento de acceder a datos de otra organización.</div>'}
  </div>`;
}
// Historial de exportaciones y transferencias que tocan la organización activa
// (como origen o como destino). Muestra qué información ha salido del sistema.
function estHistorialExportHTML(){
  const org=estOrgActiva();
  const eq=(a,b)=>String(a)===String(b);
  const regs=(_estCache.est_exportaciones||[])
    .filter(x=>eq(x.organizacionOrigen,org)||eq(x.organizacionDestino,org))
    .sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0,50);
  const destTxt=x=>x.destino==='transferencia'
    ?`↗ Transferida a <b>${escHtml(estOrgNombre(x.organizacionDestino))}</b>`
    :`⬇ Archivo (${escHtml(x.formato||'—')})`;
  return`
  <div class="card">
    <div class="card-title">🧾 Historial de exportaciones y transferencias</div>
    ${regs.length?`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Receta</th><th>Nivel</th><th>Salida</th><th>Autorizó</th></tr></thead><tbody>
    ${regs.map(x=>`<tr>
      <td>${escHtml(String(x.fecha||'').slice(0,16).replace('T',' '))}</td>
      <td>${escHtml(x.recetaNombre||'—')}${x.versionNumero?` v${x.versionNumero}`:''}</td>
      <td>${estBadgeConf(x.nivel)}</td>
      <td>${destTxt(x)}</td>
      <td>${escHtml(x.autorizadoPor||x.usuario||'—')}</td></tr>`).join('')}
    </tbody></table></div>`
    :'<div class="est-aviso">Todavía no se ha exportado ni transferido ninguna receta de esta organización. Aquí quedará registrada cada salida de información.</div>'}
  </div>`;
}
// Nombre legible de un componente (ingrediente o subreceta).
function estNombreComp(c){
  if(c.tipo==='sub'){const r=estRec(c.refId);return r?r.nombre:'(subreceta '+c.refId+')';}
  const i=estIng(c.refId);return i?i.nombre:'(ingrediente '+c.refId+')';
}
function estCompLlenarVersiones(){
  const vs=estVersionesDe(Number(v('ec-rec'))); // ordenadas desc por número
  const opts=vs.map(vr=>`<option value="${vr.id}">v${vr.numero} (${vr.estado})</option>`).join('');
  const a=document.getElementById('ec-va'),b=document.getElementById('ec-vb');
  if(a)a.innerHTML=opts;if(b)b.innerHTML=opts;
  if(b&&vs[0])b.value=vs[0].id;          // B = la más nueva
  if(a&&vs[1])a.value=vs[1].id;          // A = la anterior
  const r=document.getElementById('ec-result');if(r)r.innerHTML='';
}
async function estCompararRender(){
  const idA=Number(v('ec-va')),idB=Number(v('ec-vb'));
  if(!idA||!idB)return toast('Selecciona receta y las dos versiones','var(--red)');
  await estLoad('est_versiones','est_ingredientes','est_recetas');
  const vA=(_estCache.est_versiones||[]).find(x=>x.id===idA);
  const vB=(_estCache.est_versiones||[]).find(x=>x.id===idB);
  if(!vA||!vB)return toast('No se encontró alguna versión','var(--red)');
  const enri=vr=>({...vr,componentes:(vr.componentes||[]).map(c=>({...c,nombre:estNombreComp(c)}))});
  const d=EstCore.compararVersiones(enri(vA),enri(vB));
  const badge={agregado:'<span class="est-badge" style="background:var(--green2)">+ nuevo</span>',
    quitado:'<span class="est-badge" style="background:var(--red)">− quitado</span>',
    cambiado:'<span class="est-badge" style="background:var(--gold)">≠ cambió</span>',igual:''};
  const ubaseDe=c=>{if(c.tipo==='sub'){const r=estResolver(c.refId);return r&&r.version.salida?r.version.salida.unidad:'g';}const i=estIng(c.refId);return i?i.unidadBase:'g';};
  const filasComp=d.componentes.map(c=>{
    const ub=ubaseDe(c);
    const bg=c.estado==='igual'?'':c.estado==='agregado'?'#EAF5EA':c.estado==='quitado'?'#FBEDED':'#FBF3E0';
    return`<tr style="${bg?'background:'+bg:''}">
      <td>${escHtml(c.nombre)} ${badge[c.estado]}</td>
      <td>${c.cantidadA!=null?estFmt(c.cantidadA,ub)+(c.pctA!=null?` <span style="color:var(--gray)">(${c.pctA}%)</span>`:''):'—'}</td>
      <td>${c.cantidadB!=null?estFmt(c.cantidadB,ub)+(c.pctB!=null?` <span style="color:var(--gray)">(${c.pctB}%)</span>`:''):'—'}</td></tr>`;
  }).join('');
  const num=x=>x==null?'—':x;
  const min=x=>x==null?'—':x+' min';
  const met=(lbl,f,fmt)=>`<tr style="${f.cambio?'background:#FBF3E0':''}"><td>${lbl}${f.cambio?' <span class="est-badge" style="background:var(--gold)">≠</span>':''}</td><td>${fmt(f.a)}</td><td>${fmt(f.b)}</td></tr>`;
  document.getElementById('ec-result').innerHTML=`
    ${d.hayCambios?'':'<div class="est-aviso">Los ingredientes de ambas versiones son idénticos.</div>'}
    <div class="table-wrap"><table>
      <thead><tr><th>Concepto</th><th>v${vA.numero}</th><th>v${vB.numero}</th></tr></thead><tbody>
      <tr><td colspan="3" style="font-weight:700;color:var(--brown2)">🧾 Ingredientes / componentes</td></tr>
      ${filasComp||'<tr><td colspan="3" style="color:var(--gray)">Sin componentes</td></tr>'}
      <tr><td colspan="3" style="font-weight:700;color:var(--brown2)">📐 Métricas</td></tr>
      ${met('Salida por lote',d.salida,num)}
      ${met('Peso por unidad (g)',d.pesoUnidad,num)}
      ${met('Tiempo esperado',d.tiempoEsperadoMin,min)}
      ${met('N.º de pasos',d.nPasos,num)}
      ${met('Tiempo total de pasos',d.tiempoPasosMin,min)}
    </tbody></table></div>`;
}
async function estCrearReceta(){
  if(!estGuard('receta.crear'))return;
  const tipo=v('er-tipo');
  let nombre,productoId=null;
  if(tipo==='producto'){
    productoId=Number(v('er-producto'));
    const p=estProd(productoId);
    if(!p)return toast('⚠ Selecciona un producto (créalo primero en la pestaña Productos)','var(--red)');
    if((_estCache.est_recetas||[]).some(r=>r.productoId===productoId))return toast('⚠ Ese producto ya tiene receta maestra. Crea una nueva versión desde su receta.','var(--red)');
    nombre=p.nombre;
  }else{
    nombre=v('er-nombre').trim();
    if(!nombre)return toast('⚠ Escribe el nombre de la subreceta','var(--red)');
  }
  const ahora=new Date().toISOString();
  const recetaId=await dbAdd('est_recetas',{nombre,tipo:tipo==='sub'?'sub':'producto',productoId,organizacion:estOrgActiva(),createdAt:ahora});
  const versionId=await dbAdd('est_versiones',{
    recetaId,numero:1,estado:'borrador',responsable:v('er-resp').trim(),motivo:'Versión inicial',
    salida:{cantidad:0,unidad:tipo==='sub'?'g':'und'},pesoUnidad:null,tiempoEsperadoMin:null,
    obs:'',componentes:[],pasos:[],createdAt:ahora,updatedAt:ahora
  });
  await estAudit('receta.crear','est_recetas',recetaId,null,{nombre,tipo});
  toast('✅ Receta creada (v1 en borrador)');
  await estRenderRecetas();
  estAbrirVersion(versionId);
}
async function estAbrirVersion(versionId){
  await estLoad('est_recetas','est_versiones','est_ingredientes','est_productos','est_organizaciones');
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===versionId);if(!vr)return;
  const receta=estRec(vr.recetaId);
  estEd={recetaId:vr.recetaId,versionId,comps:JSON.parse(JSON.stringify(vr.componentes||[])),pasos:JSON.parse(JSON.stringify(vr.pasos||[]))};
  const editable=EstCore.puedeEditarVersion(vr.estado)&&estPuedeVer('receta.editar');
  const el=document.getElementById('est-rec-editor');
  const ro=editable?'':'disabled';
  el.innerHTML=`
  <div class="card" id="est-editor-card">
    <div class="card-title" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
      <span>📖 ${escHtml(receta.nombre)} — versión ${vr.numero} ${estBadge(vr.estado)} ${estBadgeConf(EstCore.nivelConfidencial(receta))}</span>
      <button class="btn bsec bsm" onclick="document.getElementById('est-rec-editor').innerHTML='';estEd=null">✖ Cerrar</button>
    </div>
    ${editable?'':'<div class="est-aviso">🔒 Esta versión no es editable'+(vr.estado==='aprobada'?' porque está APROBADA. Para cambiarla, crea una nueva versión.':'.')+'</div>'}
    ${estConfidencialUI(receta)}
    <div class="fgrid">
      <div class="fg"><label>Salida por lote *</label><input type="number" id="ev-salida" min="0" step="any" value="${escAttr(vr.salida?.cantidad||'')}" ${ro}></div>
      <div class="fg"><label>Unidad de salida</label><select id="ev-salida-u" ${ro}>
        <option value="und"${vr.salida?.unidad==='und'?' selected':''}>unidades</option>
        <option value="g"${vr.salida?.unidad==='g'?' selected':''}>gramos</option>
        <option value="ml"${vr.salida?.unidad==='ml'?' selected':''}>mililitros</option></select></div>
      <div class="fg"><label>Peso estándar por unidad (g)</label><input type="number" id="ev-pesoU" min="0" step="any" value="${escAttr(vr.pesoUnidad||'')}" ${ro}></div>
      <div class="fg"><label>Tiempo esperado del proceso (min)</label><input type="number" id="ev-tiempo" min="0" step="1" value="${escAttr(vr.tiempoEsperadoMin||'')}" ${ro}></div>
      <div class="fg"><label>Responsable</label><input type="text" id="ev-resp" value="${escAttr(vr.responsable||'')}" ${ro}></div>
      <div class="fg"><label>Motivo de esta versión</label><input type="text" id="ev-motivo" value="${escAttr(vr.motivo||'')}" ${ro}></div>
      <div class="fg fgrid one"><label>Observaciones técnicas (conocimiento práctico)</label><textarea id="ev-obs" rows="2" ${ro} placeholder="Apariencia y textura correctas de la masa, punto de mezclado, señales de fermentación, errores frecuentes...">${escHtml(vr.obs||'')}</textarea></div>
    </div>
    <div class="card-title" style="margin-top:8px">🧾 Componentes (ingredientes y subrecetas)</div>
    <div id="ev-comps"></div>
    ${editable?`<button class="btn bsec bsm add-line-btn" onclick="estAddComp()" style="margin:6px 0 14px">＋ Agregar componente</button>`:''}
    <div class="card-title">👣 Pasos del proceso</div>
    <div id="ev-pasos"></div>
    ${editable?`<button class="btn bsec bsm add-line-btn" onclick="estAddPaso()" style="margin:6px 0 14px">＋ Agregar paso</button>`:''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      ${editable?`<button class="btn bp" onclick="estGuardarVersion()">💾 Guardar</button>`:''}
      ${editable&&vr.estado==='borrador'?`<button class="btn bgold" onclick="estCambiarEstadoVersion('en_prueba')">🧪 Pasar a prueba</button>`:''}
      ${editable&&estPuedeVer('receta.aprobar')?`<button class="btn bg2" onclick="estAprobarVersion()">✅ Aprobar versión</button>`:''}
      ${estPuedeVer('receta.crear')?`<button class="btn bb" onclick="estNuevaVersion()">📄 Crear nueva versión desde esta</button>`:''}
      ${editable?`<button class="btn bsec" onclick="estCambiarEstadoVersion('archivada')">🗄 Archivar</button>`:''}
      <button class="btn bsec" onclick="estExportarReceta(${vr.id},'json')">⬇ JSON</button>
      <button class="btn bsec" onclick="estExportarReceta(${vr.id},'csv')">⬇ CSV</button>
      ${estPuedeVer('config')?`<button class="btn bsec est-admin-only" onclick="estTransferirReceta(${vr.recetaId})">↗ Copiar a otra organización</button>`:''}
    </div>
    ${vr.fechaAprobacion?`<div style="font-size:.75rem;color:var(--gray);margin-top:8px">Aprobada el ${escHtml(String(vr.fechaAprobacion).slice(0,10))} por ${escHtml(vr.aprobadoPor||'—')}</div>`:''}
  </div>`;
  estRenderComps(editable);
  estRenderPasos(editable);
  el.scrollIntoView({behavior:'smooth'});
}
function estCompUnidades(c){
  if(c.tipo==='sub'){
    const r=estResolver(c.refId);
    const u=r&&r.version.salida?r.version.salida.unidad:'g';
    return u==='g'?['g','kg']:u==='ml'?['ml','L']:['und'];
  }
  const ing=estIng(c.refId);
  return ing?estUnidadesPracticas(ing):['g'];
}
function estCompUnidadBase(c){
  if(c.tipo==='sub'){const r=estResolver(c.refId);return r&&r.version.salida?r.version.salida.unidad:'g'}
  const ing=estIng(c.refId);return ing?ing.unidadBase:'g';
}
function estRenderComps(editable){
  const cont=document.getElementById('ev-comps');if(!cont)return;
  const ings=(_estCache.est_ingredientes||[]).filter(i=>i.estado!=='inactivo');
  const subs=(_estCache.est_recetas||[]).filter(r=>r.tipo==='sub'&&r.id!==estEd.recetaId);
  const conPct=EstCore.calcularPorcentajes(estEd.comps.map(c=>({...c,cantidad:c.cantidadBase})));
  cont.innerHTML=`<div class="table-wrap"><table><thead><tr><th>#</th><th>Tipo</th><th>Ingrediente / subreceta</th><th>Cantidad</th><th>Unidad</th><th>%</th><th>Base</th><th>Merma est. %</th><th>Oblig.</th><th>Indicaciones / sustituto</th>${editable?'<th>🗑</th>':''}</tr></thead><tbody>
  ${estEd.comps.map((c,i)=>{
    const unidades=estCompUnidades(c);
    return`<tr>
    <td>${i+1}</td>
    <td>${editable?`<select onchange="estEd.comps[${i}].tipo=this.value;estEd.comps[${i}].refId=null;estRenderComps(true)"><option value="ing"${c.tipo!=='sub'?' selected':''}>Ingrediente</option><option value="sub"${c.tipo==='sub'?' selected':''}>Subreceta</option></select>`:(c.tipo==='sub'?'Subreceta':'Ingrediente')}</td>
    <td>${editable?`<select onchange="estCompSetRef(${i},this.value)"><option value="">Seleccionar...</option>${(c.tipo==='sub'?subs:ings).map(x=>`<option value="${x.id}"${c.refId===x.id?' selected':''}>${escHtml(x.nombre)}</option>`).join('')}</select>`:escHtml(c.nombre||'—')}</td>
    <td>${editable?`<input type="number" min="0" step="any" style="width:90px" value="${escAttr(c.cantidadIngreso??'')}" oninput="estCompSetCant(${i},this.value,null)">`:escHtml(String(c.cantidadIngreso??''))}</td>
    <td>${editable?`<select onchange="estCompSetCant(${i},null,this.value)">${unidades.map(u=>`<option${(c.unidadIngreso||unidades[0])===u?' selected':''}>${u}</option>`).join('')}</select>`:escHtml(c.unidadIngreso||'')} <span style="font-size:.72rem;color:var(--gray)">${c.cantidadBase?('= '+estFmt(c.cantidadBase,estCompUnidadBase(c))):''}</span></td>
    <td>${conPct[i]&&conPct[i].porcentaje!=null?conPct[i].porcentaje+'%':'—'}</td>
    <td><input type="radio" name="ev-base" ${c.esBase?'checked':''} ${editable?`onchange="estEd.comps.forEach(x=>x.esBase=false);estEd.comps[${i}].esBase=true;estRenderComps(true)"`:'disabled'}></td>
    <td>${editable?`<input type="number" min="0" max="99" step="any" style="width:70px" value="${escAttr(c.mermaPct??'')}" oninput="estEd.comps[${i}].mermaPct=toNum(this.value)">`:escHtml(String(c.mermaPct??'—'))}</td>
    <td><input type="checkbox" ${c.obligatorio!==false?'checked':''} ${editable?`onchange="estEd.comps[${i}].obligatorio=this.checked"`:'disabled'}></td>
    <td>${editable?`<input type="text" style="min-width:140px" value="${escAttr(c.indicaciones||'')}" placeholder="Indicaciones" oninput="estEd.comps[${i}].indicaciones=this.value"><input type="text" style="min-width:140px;margin-top:3px" value="${escAttr(c.sustituto||'')}" placeholder="Sustituto permitido" oninput="estEd.comps[${i}].sustituto=this.value">`:escHtml([c.indicaciones,c.sustituto&&('Sust.: '+c.sustituto)].filter(Boolean).join(' · ')||'—')}</td>
    ${editable?`<td><button class="del-btn" onclick="estEd.comps.splice(${i},1);estRenderComps(true)">🗑</button></td>`:''}
  </tr>`}).join('')||`<tr><td colspan="11" class="empty">Sin componentes</td></tr>`}
  </tbody></table></div>
  <div style="font-size:.74rem;color:var(--gray);margin-top:4px">El componente marcado como <b>Base</b> define el 100% para el porcentaje panadero (normalmente la harina, pero puede ser cualquier ingrediente).</div>`;
}
function estAddComp(){
  estEd.comps.push({tipo:'ing',refId:null,nombre:'',cantidadIngreso:'',unidadIngreso:'',cantidadBase:0,unidadBase:'g',esBase:estEd.comps.length===0,orden:estEd.comps.length+1,mermaPct:0,obligatorio:true,indicaciones:'',sustituto:''});
  estRenderComps(true);
}
function estCompSetRef(i,val){
  const c=estEd.comps[i];
  c.refId=val?Number(val):null;
  if(c.tipo==='sub'){const r=estResolver(c.refId);c.nombre=r?r.receta.nombre:'';}
  else{const ing=estIng(c.refId);c.nombre=ing?ing.nombre:'';c.unidadBase=ing?ing.unidadBase:'g';}
  c.unidadIngreso='';c.cantidadBase=0;c.cantidadIngreso='';
  estRenderComps(true);
}
function estCompSetCant(i,cant,unidad){
  const c=estEd.comps[i];
  if(cant!=null)c.cantidadIngreso=cant;
  if(unidad!=null)c.unidadIngreso=unidad;
  if(!c.unidadIngreso)c.unidadIngreso=estCompUnidades(c)[0];
  const ub=estCompUnidadBase(c);
  const pres=c.tipo==='sub'?[]:(estIng(c.refId)||{}).presentaciones||[];
  const conv=EstCore.aBase(toNum(c.cantidadIngreso),c.unidadIngreso,ub,pres);
  c.cantidadBase=conv.ok?conv.cantidadBase:0;
  c.unidadBase=ub;
  if(unidad!=null)estRenderComps(true);
  else{ // solo refrescar columna % y equivalencia sin perder foco
    const conPct=EstCore.calcularPorcentajes(estEd.comps.map(x=>({...x,cantidad:x.cantidadBase})));
    const tabla=document.querySelectorAll('#ev-comps tbody tr');
    estEd.comps.forEach((x,j)=>{
      const celdas=tabla[j]&&tabla[j].querySelectorAll('td');
      if(celdas&&celdas[5])celdas[5].textContent=conPct[j].porcentaje!=null?conPct[j].porcentaje+'%':'—';
      if(celdas&&celdas[4]){const sp=celdas[4].querySelector('span');if(sp)sp.textContent=x.cantidadBase?('= '+estFmt(x.cantidadBase,estCompUnidadBase(x))):''}
    });
  }
}
function estRenderPasos(editable){
  const cont=document.getElementById('ev-pasos');if(!cont)return;
  cont.innerHTML=(estEd.pasos.map((p,i)=>`
  <div class="est-paso">
    <div class="est-paso-head"><b>Paso ${i+1}</b>${editable?`<span><button class="btn bsec bsm" ${i===0?'disabled':''} onclick="const t=estEd.pasos[${i}];estEd.pasos[${i}]=estEd.pasos[${i-1}];estEd.pasos[${i-1}]=t;estRenderPasos(true)">↑</button> <button class="del-btn" onclick="estEd.pasos.splice(${i},1);estRenderPasos(true)">🗑</button></span>`:''}</div>
    <div class="fgrid three">
      <div class="fg"><label>Operación</label><input type="text" list="est-ops" value="${escAttr(p.nombre||'')}" ${editable?`oninput="estEd.pasos[${i}].nombre=this.value"`:'disabled'}></div>
      <div class="fg"><label>Tiempo (min)</label><input type="number" min="0" step="any" value="${escAttr(p.tiempoMin??'')}" ${editable?`oninput="estEd.pasos[${i}].tiempoMin=toNum(this.value)"`:'disabled'}></div>
      <div class="fg"><label>Temperatura (°C)</label><input type="number" step="any" value="${escAttr(p.tempC??'')}" ${editable?`oninput="estEd.pasos[${i}].tempC=toNum(this.value)"`:'disabled'}></div>
      <div class="fg"><label>Equipo</label><input type="text" value="${escAttr(p.equipo||'')}" ${editable?`oninput="estEd.pasos[${i}].equipo=this.value"`:'disabled'}></div>
      <div class="fg"><label>Velocidad / nivel</label><input type="text" value="${escAttr(p.velocidad||'')}" ${editable?`oninput="estEd.pasos[${i}].velocidad=this.value"`:'disabled'}></div>
      <div class="fg"><label>Capacidad máx. equipo (g o und)</label><input type="number" min="0" step="any" value="${escAttr(p.capacidadMax??'')}" ${editable?`oninput="estEd.pasos[${i}].capacidadMax=toNum(this.value)"`:'disabled'}></div>
      <div class="fg fgrid one"><label>Descripción</label><input type="text" value="${escAttr(p.descripcion||'')}" ${editable?`oninput="estEd.pasos[${i}].descripcion=this.value"`:'disabled'}></div>
      <div class="fg"><label>Señales visuales (apariencia, color)</label><input type="text" value="${escAttr(p.visual||'')}" ${editable?`oninput="estEd.pasos[${i}].visual=this.value"`:'disabled'}></div>
      <div class="fg"><label>Señales táctiles (textura, elasticidad)</label><input type="text" value="${escAttr(p.tactil||'')}" ${editable?`oninput="estEd.pasos[${i}].tactil=this.value"`:'disabled'}></div>
      <div class="fg"><label>Riesgos / errores frecuentes</label><input type="text" value="${escAttr(p.riesgos||'')}" ${editable?`oninput="estEd.pasos[${i}].riesgos=this.value"`:'disabled'}></div>
      <div class="fg"><label>Punto de control</label><select ${editable?`onchange="estEd.pasos[${i}].puntoControl=this.value==='si'"`:'disabled'}><option value="no"${!p.puntoControl?' selected':''}>No</option><option value="si"${p.puntoControl?' selected':''}>Sí</option></select></div>
    </div>
  </div>`).join(''))||'<div style="font-size:.78rem;color:var(--gray)">Sin pasos registrados</div>';
}
function estAddPaso(){
  estEd.pasos.push({nombre:'',descripcion:'',tiempoMin:null,tempC:null,velocidad:'',equipo:'',capacidadMax:null,visual:'',tactil:'',riesgos:'',puntoControl:false});
  estRenderPasos(true);
}
function estLeerVersionForm(vr){
  return{...vr,
    salida:{cantidad:toNum(v('ev-salida')),unidad:v('ev-salida-u')},
    pesoUnidad:toNum(v('ev-pesoU'))||null,
    tiempoEsperadoMin:toNum(v('ev-tiempo'))||null,
    responsable:v('ev-resp').trim(),motivo:v('ev-motivo').trim(),
    obs:(document.getElementById('ev-obs')||{}).value||'',
    componentes:estEd.comps.map((c,i)=>({...c,orden:i+1,cantidad:c.cantidadBase})),
    pasos:estEd.pasos.map((p,i)=>({...p,n:i+1})),
    updatedAt:new Date().toISOString()};
}
async function estGuardarVersion(silencioso){
  if(!estGuard('receta.editar'))return null;
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===estEd.versionId);
  if(!vr)return null;
  if(!EstCore.puedeEditarVersion(vr.estado)){toast('⛔ Esta versión ya no es editable. Crea una nueva versión.','var(--red)');return null}
  const nuevo=estLeerVersionForm(vr);
  // Validar ciclos de subrecetas antes de guardar
  if(EstCore.creaCiclo(estEd.recetaId,nuevo.componentes,estResolverComponentes)){
    toast('⛔ Los componentes crean un ciclo de subrecetas (una receta se incluye a sí misma)','var(--red)');return null;
  }
  const invalidos=nuevo.componentes.filter(c=>!c.refId||!(c.cantidadBase>0));
  if(invalidos.length){toast('⚠ Hay componentes sin ingrediente o sin cantidad válida','var(--red)');return null}
  await dbPut('est_versiones',nuevo);
  await estAudit('receta.version.guardar','est_versiones',vr.id,{componentes:vr.componentes,salida:vr.salida},{componentes:nuevo.componentes,salida:nuevo.salida});
  _estCache.est_versiones=_estCache.est_versiones.map(x=>x.id===vr.id?nuevo:x);
  if(!silencioso){toast('💾 Versión guardada');estAbrirVersion(vr.id)}
  return nuevo;
}
async function estCambiarEstadoVersion(nuevoEstado){
  if(!estGuard('receta.editar'))return;
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===estEd.versionId);if(!vr)return;
  if(!EstCore.transicionVersionValida(vr.estado,nuevoEstado))return toast(`⛔ Transición no permitida: ${vr.estado} → ${nuevoEstado}`,'var(--red)');
  if(nuevoEstado==='archivada'&&!confirm('¿Archivar esta versión? Ya no podrá usarse en nuevas órdenes.'))return;
  const guardada=await estGuardarVersion(true);if(!guardada)return;
  guardada.estado=nuevoEstado;guardada.updatedAt=new Date().toISOString();
  await dbPut('est_versiones',guardada);
  await estAudit('receta.version.estado','est_versiones',vr.id,{estado:vr.estado},{estado:nuevoEstado});
  toast('✅ Estado actualizado: '+nuevoEstado);
  await estRenderRecetas();estAbrirVersion(vr.id);
}
async function estAprobarVersion(){
  if(!estGuard('receta.aprobar'))return;
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===estEd.versionId);if(!vr)return;
  const guardada=await estGuardarVersion(true);if(!guardada)return;
  const errores=EstCore.validarVersion({...guardada,componentes:guardada.componentes.map(c=>({...c,cantidad:c.cantidadBase}))});
  if(errores.length)return toast('⚠ '+errores[0],'var(--red)');
  if(!confirm('¿Aprobar esta versión? Una vez aprobada NO podrá modificarse; para cambios habrá que crear una nueva versión.'))return;
  // La versión aprobada anterior pasa a "reemplazada"
  for(const otra of estVersionesDe(estEd.recetaId).filter(x=>x.estado==='aprobada'&&x.id!==vr.id)){
    otra.estado='reemplazada';otra.updatedAt=new Date().toISOString();
    await dbPut('est_versiones',otra);
    await estAudit('receta.version.estado','est_versiones',otra.id,{estado:'aprobada'},{estado:'reemplazada'},'Reemplazada por v'+guardada.numero);
  }
  guardada.estado='aprobada';
  guardada.fechaAprobacion=new Date().toISOString();
  guardada.aprobadoPor=estRol();
  guardada.updatedAt=guardada.fechaAprobacion;
  await dbPut('est_versiones',guardada);
  await estAudit('receta.version.aprobar','est_versiones',vr.id,{estado:vr.estado},{estado:'aprobada'},guardada.motivo);
  toast('✅ Versión aprobada');
  await estRenderRecetas();estAbrirVersion(vr.id);
}
async function estNuevaVersion(){
  if(!estGuard('receta.crear'))return;
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===estEd.versionId);if(!vr)return;
  const motivo=prompt('Motivo del cambio para la nueva versión:');
  if(motivo===null)return;
  const nums=estVersionesDe(estEd.recetaId).map(x=>x.numero);
  const ahora=new Date().toISOString();
  const nueva={...JSON.parse(JSON.stringify(vr)),numero:Math.max(...nums)+1,estado:'borrador',motivo:motivo.trim()||'Nueva versión',fechaAprobacion:null,aprobadoPor:null,createdAt:ahora,updatedAt:ahora};
  delete nueva.id;
  const id=await dbAdd('est_versiones',nueva);
  await estAudit('receta.version.crear','est_versiones',id,null,{recetaId:estEd.recetaId,numero:nueva.numero,motivo:nueva.motivo});
  toast('📄 Nueva versión v'+nueva.numero+' creada en borrador');
  await estRenderRecetas();estAbrirVersion(id);
}
// Panel de confidencialidad dentro del editor de receta. El nivel es de la
// RECETA (no de la versión): decide si su contenido puede salir del sistema.
function estConfidencialUI(receta){
  const nivel=EstCore.nivelConfidencial(receta);
  const pol=EstCore.politicaConfidencial(nivel);
  const info=EstCore.NIVELES_CONFIDENCIALIDAD.find(x=>x.id===nivel);
  const puede=estPuedeVer('receta.editar');
  const accTxt=a=>a==='permitido'?'<span style="color:var(--green)">permitido</span>':a==='autorizar'?'<span style="color:var(--gold)">con autorización</span>':'<span style="color:var(--red)">bloqueado</span>';
  return`
  <div class="est-conf-box">
    <div class="est-conf-row">
      <label>🔐 Confidencialidad de la receta</label>
      ${puede?`<select class="est-conf-sel est-admin-only" onchange="estSetConfidencialidad(${receta.id},this.value)">
        ${EstCore.NIVELES_CONFIDENCIALIDAD.map(n=>`<option value="${n.id}"${n.id===nivel?' selected':''}>${escHtml(n.label)}</option>`).join('')}
      </select>`:estBadgeConf(nivel)}
    </div>
    <div class="est-conf-desc">${escHtml(info?info.desc:'')}<br><b>Exportar a archivo:</b> ${accTxt(pol.exportar)} · <b>Copiar a otra organización:</b> ${accTxt(pol.transferir)}.</div>
  </div>`;
}
async function estSetConfidencialidad(recetaId,nivel){
  if(!estGuard('receta.editar'))return;
  const receta=estRec(recetaId);if(!receta)return;
  const antes=EstCore.nivelConfidencial(receta);
  const nuevo=EstCore.normNivelConfidencial(nivel);
  if(antes===nuevo)return;
  await dbPut('est_recetas',{...receta,confidencialidad:nuevo});
  await estAudit('receta.confidencialidad','est_recetas',recetaId,{confidencialidad:antes},{confidencialidad:nuevo});
  await estLoad('est_recetas');
  const lbl=(EstCore.NIVELES_CONFIDENCIALIDAD.find(x=>x.id===nuevo)||{label:nuevo}).label;
  toast('🔐 Confidencialidad: '+lbl);
  estAbrirVersion(estEd.versionId);
}
// Copia una receta (y todas sus versiones) a OTRA organización. Solo se
// permite si la receta está autorizada (plantilla o transferible). La copia
// queda como INTERNA en el destino para evitar reenvíos en cadena.
async function estTransferirReceta(recetaId){
  if(!estGuard('config'))return;
  await estLoad('est_recetas','est_versiones','est_organizaciones');
  const receta=estRec(recetaId);if(!receta)return;
  const nivel=EstCore.nivelConfidencial(receta);
  if(!EstCore.puedeTransferirReceta(nivel)){
    toast('⛔ Esta receta ('+nivel+') no está autorizada a copiarse a otra organización. Márcala como "Plantilla" o "Transferible" solo si tienes autorización expresa.','var(--red)');
    return;
  }
  const origen=receta.organizacion!=null?receta.organizacion:estOrgActiva();
  const destinos=estOrgs().filter(o=>String(o.id)!==String(origen));
  if(!destinos.length){toast('⚠ No hay otra organización de destino. Crea una primero en la barra 🏢 Organización.','var(--gold)');return;}
  const lista=destinos.map((o,i)=>`${i+1}) ${o.nombre}`).join('\n');
  const sel=prompt('Copiar "'+receta.nombre+'" a otra organización.\nEscribe el número de la organización destino:\n'+lista);
  if(sel==null)return;
  const destino=destinos[Number(sel)-1];
  if(!destino){toast('⚠ Selección inválida','var(--red)');return;}
  const quien=prompt('Autorización EXPRESA de transferencia.\nEscribe tu nombre para registrar quién autoriza la copia:');
  if(quien==null)return;
  if(!confirm('¿Copiar la receta "'+receta.nombre+'" a "'+destino.nombre+'"?\nLa copia quedará como INTERNA en la organización destino.'))return;
  // La copia y la verificación de confidencialidad las hace el SERVIDOR (no solo
  // la interfaz): el backend rechaza la transferencia si el nivel no la permite.
  try{
    const r=await api('/api/org/transferir-receta',{method:'POST',body:{recetaId:receta.id,destinoOrgId:destino.id,autorizadoPor:quien.trim()||estRol()}});
    await estLoad('est_recetas','est_versiones','est_exportaciones','est_accesos');
    toast('↗ Receta copiada a '+destino.nombre+' ('+(r.versiones||0)+' versión(es); queda como interna allí)');
    estRenderRecetas();
  }catch(e){toast('⛔ '+e.message,'var(--red)');}
}
async function estExportarReceta(versionId,formato){
  if(!estGuard('exportar'))return;
  await estLoad('est_versiones','est_recetas');
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===versionId);if(!vr)return;
  const receta=estRec(vr.recetaId);
  const nivel=EstCore.nivelConfidencial(receta);
  if(!EstCore.puedeExportarReceta(nivel)){
    toast('⛔ Receta RESTRINGIDA: no se puede exportar. Cambia su confidencialidad solo si tienes autorización.','var(--red)');
    return;
  }
  let autorizadoPor=null;
  if(EstCore.requiereAutorizacionExport(nivel)){
    const quien=prompt('Esta receta es INTERNA. La exportación quedará registrada en el historial.\nEscribe tu nombre para autorizar la exportación:');
    if(quien==null)return;
    autorizadoPor=quien.trim()||estRol();
  }
  let blob,nombre;
  if(formato==='csv'){
    const filas=[['Receta',receta.nombre],['Versión',vr.numero],['Estado',vr.estado],['Salida',`${vr.salida?.cantidad} ${vr.salida?.unidad}`],[],
      ['#','Tipo','Nombre','Cantidad (base)','Unidad base','%','Merma est. %','Indicaciones']];
    EstCore.calcularPorcentajes((vr.componentes||[]).map(c=>({...c,cantidad:c.cantidadBase}))).forEach((c,i)=>{
      filas.push([i+1,c.tipo==='sub'?'Subreceta':'Ingrediente',c.nombre,c.cantidadBase,c.unidadBase||'',c.porcentaje??'',c.mermaPct??'',c.indicaciones||'']);
    });
    filas.push([],['#','Paso','Tiempo (min)','Temp (°C)','Equipo','Señales visuales','Señales táctiles']);
    (vr.pasos||[]).forEach((p,i)=>filas.push([i+1,p.nombre,p.tiempoMin??'',p.tempC??'',p.equipo||'',p.visual||'',p.tactil||'']));
    const csv=filas.map(f=>f.map(x=>`"${String(x??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    blob=new Blob(['﻿'+csv],{type:'text/csv'});nombre=`Receta_${receta.nombre}_v${vr.numero}.csv`;
  }else{
    blob=new Blob([JSON.stringify({receta:{nombre:receta.nombre,tipo:receta.tipo},version:vr},null,2)],{type:'application/json'});
    nombre=`Receta_${receta.nombre}_v${vr.numero}.json`;
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nombre.replace(/[^\w.\-]+/g,'_');a.click();URL.revokeObjectURL(a.href);
  await estRegistrarExport({receta,version:vr,formato,destino:'archivo',autorizadoPor});
  toast('⬇ Receta exportada (registrada en el historial)');
}

// ════════════════════════════════════════════════════════════════
// CALCULADORA DE PRODUCCIÓN
// ════════════════════════════════════════════════════════════════
let _estCalcRes=null;
async function estRenderCalc(){
  const el=document.getElementById('est-calc');if(!el)return;
  await estLoad('est_recetas','est_versiones','est_ingredientes','est_productos');
  const recetas=(_estCache.est_recetas||[]).filter(r=>estVersionesDe(r.id).length);
  el.innerHTML=`
  <div class="card">
    <div class="card-title">🧮 Calculadora de producción</div>
    <div class="fgrid">
      <div class="fg"><label>Receta</label><select id="ec-receta" onchange="estCalcFillVersiones()">
        <option value="">Seleccionar...</option>
        ${recetas.map(r=>`<option value="${r.id}">${r.tipo==='sub'?'🥣 ':''}${escHtml(r.nombre)}</option>`).join('')}</select></div>
      <div class="fg"><label>Versión</label><select id="ec-version"></select></div>
      <div class="fg"><label>Modalidad</label><select id="ec-modo" onchange="estCalcModoUI()">
        <option value="A">A — Producir una cantidad</option>
        <option value="B">B — Según ingrediente disponible</option>
        <option value="C">C — Escalar por porcentaje</option></select></div>
    </div>
    <div class="fgrid" id="ec-modo-a">
      <div class="fg"><label>Cantidad deseada</label><input type="number" id="ec-cant" min="0" step="any" placeholder="Ej.: 200"></div>
    </div>
    <div class="fgrid" id="ec-modo-b" style="display:none">
      <div class="fg"><label>Ingrediente disponible</label><select id="ec-ing"></select></div>
      <div class="fg"><label>Cantidad disponible</label><input type="number" id="ec-disp" min="0" step="any" placeholder="Ej.: 15"></div>
      <div class="fg"><label>Unidad</label><select id="ec-disp-u"></select></div>
    </div>
    <div class="fgrid" id="ec-modo-c" style="display:none">
      <div class="fg"><label>Porcentaje de la receta (%)</label><input type="number" id="ec-pct" min="0" step="any" placeholder="Ej.: 50 = mitad, 200 = doble"></div>
    </div>
    <button class="btn bp btn-full" onclick="estCalcular()">🧮 Calcular</button>
  </div>
  <div id="ec-resultado"></div>`;
}
function estCalcFillVersiones(){
  const recetaId=Number(v('ec-receta'));
  const sel=document.getElementById('ec-version');
  const vs=estVersionesDe(recetaId).filter(x=>x.estado!=='archivada');
  sel.innerHTML=vs.map(x=>`<option value="${x.id}"${x.estado==='aprobada'?' selected':''}>v${x.numero} — ${x.estado}${x.estado!=='aprobada'?' ⚠':''}</option>`).join('');
  estCalcFillIngredientes();
}
function estCalcFillIngredientes(){
  const versionId=Number(v('ec-version'));
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===versionId);
  const selI=document.getElementById('ec-ing');if(!selI)return;
  if(!vr){selI.innerHTML='';return}
  const req=EstCore.expandirRequerimientos(vr,1,estResolver);
  selI.innerHTML=[...req.ingredientes.values()].map(i=>`<option value="${i.refId}">${escHtml(i.nombre)}</option>`).join('');
  estCalcFillUnidades();
}
function estCalcFillUnidades(){
  const ing=estIng(Number(v('ec-ing')));
  const selU=document.getElementById('ec-disp-u');if(!selU)return;
  selU.innerHTML=(ing?estUnidadesPracticas(ing):['g','kg']).map(u=>`<option>${u}</option>`).join('');
}
function estCalcModoUI(){
  const m=v('ec-modo');
  document.getElementById('ec-modo-a').style.display=m==='A'?'':'none';
  document.getElementById('ec-modo-b').style.display=m==='B'?'':'none';
  document.getElementById('ec-modo-c').style.display=m==='C'?'':'none';
  if(m==='B')estCalcFillIngredientes();
}
async function estCalcular(){
  const versionId=Number(v('ec-version'));
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===versionId);
  if(!vr)return toast('⚠ Selecciona receta y versión','var(--red)');
  const receta=estRec(vr.recetaId);
  const producto=receta.productoId?estProd(receta.productoId):null;
  const vCalc={...vr,componentes:(vr.componentes||[]).map(c=>({...c,cantidad:c.cantidadBase}))};
  const modo=v('ec-modo');
  let res;
  if(modo==='A')res=EstCore.calcularPorUnidades(vCalc,toNum(v('ec-cant')),estResolver,producto);
  else if(modo==='B'){
    const ingId=Number(v('ec-ing'));
    const ing=estIng(ingId);
    const conv=EstCore.aBase(toNum(v('ec-disp')),v('ec-disp-u'),ing?ing.unidadBase:'g',ing?ing.presentaciones:[]);
    if(!conv.ok)return toast('⚠ '+conv.error,'var(--red)');
    res=EstCore.calcularPorIngrediente(vCalc,ingId,conv.cantidadBase,estResolver,producto);
  }else res=EstCore.escalarPorFactor(vCalc,toNum(v('ec-pct'))/100,estResolver,producto);
  const out=document.getElementById('ec-resultado');
  if(!res.ok){out.innerHTML=`<div class="card"><div class="est-aviso" style="border-color:var(--red);color:var(--red)">⚠ ${escHtml(res.error)}</div></div>`;_estCalcRes=null;return}
  _estCalcRes={res,versionId,recetaId:vr.recetaId,productoId:receta.productoId};
  const pct=EstCore.calcularPorcentajes(res.ingredientes.map(i=>({...i,cantidad:i.cantidadBase,esBase:(vr.componentes||[]).some(c=>c.esBase&&c.refId===i.refId&&c.tipo!=='sub')})));
  out.innerHTML=`
  <div class="card">
    <div class="card-title">Resultado — ${escHtml(receta.nombre)} v${vr.numero} ${vr.estado!=='aprobada'?'<span class="est-aviso" style="display:inline-block;padding:2px 8px">⚠ versión NO aprobada</span>':''}</div>
    <div class="est-stats">
      <div class="est-stat"><div class="est-stat-v">${EstCore.redondear(res.unidades,2)} ${vr.salida.unidad}</div><div class="est-stat-l">Salida esperada</div></div>
      <div class="est-stat"><div class="est-stat-v">${res.pesoTotalEsperado?estFmt(res.pesoTotalEsperado,'g'):'—'}</div><div class="est-stat-l">Peso total esperado</div></div>
      <div class="est-stat"><div class="est-stat-v">${res.bandejas??'—'}</div><div class="est-stat-l">Bandejas</div></div>
      <div class="est-stat"><div class="est-stat-v">${res.tandas??'—'}</div><div class="est-stat-l">Tandas / lotes</div></div>
      <div class="est-stat"><div class="est-stat-v">×${EstCore.redondear(res.factor,3)}</div><div class="est-stat-l">Factor de escala</div></div>
    </div>
    ${res.errores&&res.errores.length?`<div class="est-aviso">⚠ ${res.errores.map(escHtml).join('<br>')}</div>`:''}
    ${res.sobranteBase!=null?`<div class="est-aviso" style="border-color:var(--green);color:var(--green)">Sobrante estimado del ingrediente limitante: ${estFmt(res.sobranteBase,(estIng(res.ingredienteLimitante)||{}).unidadBase||'g')}</div>`:''}
    <div class="card-title" style="margin-top:8px">Ingredientes totales (incluye subrecetas expandidas y mermas estimadas)</div>
    <div class="table-wrap"><table><thead><tr><th>Ingrediente</th><th>Cantidad</th><th>%</th></tr></thead><tbody>
      ${pct.map(i=>`<tr><td>${escHtml(i.nombre)}</td><td><b>${estFmt(i.cantidadBase,i.unidadBase)}</b></td><td>${i.porcentaje!=null?i.porcentaje+'%':'—'}</td></tr>`).join('')}
    </tbody></table></div>
    ${res.subrecetas.length?`<div class="card-title" style="margin-top:8px">Subrecetas necesarias</div>
    <div class="table-wrap"><table><thead><tr><th>Subreceta</th><th>Cantidad</th><th>Lotes de subreceta</th></tr></thead><tbody>
      ${res.subrecetas.map(s=>`<tr><td>${'&nbsp;'.repeat((s.nivel-1)*3)}${escHtml(s.nombre)}</td><td>${estFmt(s.cantidadBase,s.unidadBase)}</td><td>×${EstCore.redondear(s.lotes,3)}</td></tr>`).join('')}
    </tbody></table></div>`:''}
    ${estPuedeVer('orden.crear')?`<button class="btn bg2 btn-full" style="margin-top:10px" onclick="estCrearOrdenDesdeCalc()">📋 Crear orden de producción con este cálculo</button>`:''}
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// ÓRDENES DE PRODUCCIÓN Y LOTES
// ════════════════════════════════════════════════════════════════
async function estCrearOrdenDesdeCalc(){
  if(!estGuard('orden.crear'))return;
  if(!_estCalcRes)return toast('⚠ Primero realiza un cálculo','var(--red)');
  const{res,versionId,recetaId,productoId}=_estCalcRes;
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===versionId);
  const receta=estRec(recetaId);
  const producto=productoId?estProd(productoId):null;
  if(vr.estado!=='aprobada'&&!confirm('La versión seleccionada NO está aprobada. ¿Crear la orden de todos modos?'))return;
  const ahora=new Date().toISOString();
  const orden={
    codigo:EstCore.genCodigo('OP',await estSeq('est_ordenes'),hoy()),
    recetaId,versionId,versionNumero:vr.numero,productoId:productoId||null,
    // Snapshot inmutable: cambios futuros de la receta no alteran esta orden
    snapshot:EstCore.snapshotVersion(vr,receta,producto),
    plan:{
      unidades:res.unidades,factor:res.factor,
      pesoTotalEsperado:res.pesoTotalEsperado,bandejas:res.bandejas,tandas:res.tandas,
      tiempoEsperadoMin:vr.tiempoEsperadoMin||null,
      ingredientes:res.ingredientes.map(i=>({refId:i.refId,nombre:i.nombre,unidadBase:i.unidadBase,cantidadBase:i.cantidadBase})),
      subrecetas:res.subrecetas
    },
    fecha:hoy(),turno:'',responsable:'',equipo:'',
    estado:'borrador',real:null,kpis:null,muestrasPeso:[],calidad:null,loteId:null,
    createdAt:ahora,updatedAt:ahora
  };
  const id=await dbAdd('est_ordenes',orden);
  await estAudit('orden.crear','est_ordenes',id,null,{codigo:orden.codigo,receta:receta.nombre,version:vr.numero,unidades:res.unidades});
  toast('📋 Orden creada: '+orden.codigo);
  switchTab('est','ord',document.querySelector('#page-estandarizacion .tab[data-tab="ord"]'));
  await estRenderOrdenes(id);
}
async function estRenderOrdenes(abrirId){
  const el=document.getElementById('est-ord');if(!el)return;
  await estLoad(...EST_STORES);
  const ords=(_estCache.est_ordenes||[]).sort((a,b)=>b.id-a.id);
  const lotes=(_estCache.est_lotes||[]).sort((a,b)=>b.id-a.id);
  el.innerHTML=`
  <div class="card"><div class="card-title">📋 Órdenes de producción (${ords.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Fecha</th><th>Producto / receta</th><th>Versión</th><th>Plan</th><th>Estado</th><th>Ver</th></tr></thead><tbody>
    ${ords.length?ords.map(o=>{
      const nom=o.snapshot?.producto?.nombre||o.snapshot?.receta?.nombre||'—';
      return`<tr><td>${escHtml(o.codigo)}</td><td>${fmt(o.fecha)}</td><td>${escHtml(nom)}${o.demo?' <span class="est-demo">DEMO</span>':''}</td><td>v${o.versionNumero}</td>
      <td>${EstCore.redondear(o.plan?.unidades||0,1)} ${o.snapshot?.version?.salida?.unidad||''}</td><td>${estBadge(o.estado)}</td>
      <td><button class="btn bsec bsm" onclick="estAbrirOrden(${o.id})">Abrir</button></td></tr>`;
    }).join(''):empty(7)}</tbody></table></div></div>
  <div class="card"><div class="card-title">🏷 Lotes (${lotes.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Fecha</th><th>Producto</th><th>Producidas</th><th>Aprobadas</th><th>Rechazadas</th><th>Vence</th><th>Estado</th></tr></thead><tbody>
    ${lotes.length?lotes.map(l=>`<tr><td>${escHtml(l.codigo)}</td><td>${fmt(l.fecha)}</td><td>${escHtml(l.productoNombre||'—')}</td><td>${l.cantidadProducida??'—'}</td><td>${l.cantidadAprobada??'—'}</td><td>${l.cantidadRechazada??'—'}</td><td>${l.vencimiento?fmt(l.vencimiento):'—'}</td><td>${estBadge(l.estado)}</td></tr>`).join(''):empty(8)}</tbody></table></div></div>
  <div id="est-orden-detalle"></div>`;
  if(abrirId)estAbrirOrden(abrirId);
}
function estOrden(id){return(_estCache.est_ordenes||[]).find(o=>o.id===id)}
async function estAbrirOrden(id){
  const o=estOrden(id);if(!o)return;
  const el=document.getElementById('est-orden-detalle');
  const snap=o.snapshot||{};
  const puedeEstado=estPuedeVer('orden.estado');
  const transiciones=puedeEstado?(o.estado==='en_proceso'?['pausada','cancelada']:{borrador:['programada','cancelada'],programada:['en_proceso','cancelada'],pausada:['en_proceso','cancelada']}[o.estado]||[]):[];
  const lblEstado={programada:'📅 Programar',en_proceso:'▶ Iniciar producción',pausada:'⏸ Pausar',cancelada:'✖ Cancelar',terminada:'✔ Terminar'};
  el.innerHTML=`
  <div class="card" id="est-orden-card">
    <div class="card-title" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
      <span>📋 ${escHtml(o.codigo)} — ${escHtml(snap.producto?.nombre||snap.receta?.nombre||'')} (v${o.versionNumero}) ${estBadge(o.estado)}</span>
      <span><button class="btn bsec bsm" onclick="estImprimirOrden(${o.id})">🖨 Imprimir</button>
      <button class="btn bsec bsm" onclick="document.getElementById('est-orden-detalle').innerHTML=''">✖ Cerrar</button></span>
    </div>
    <div class="fgrid">
      <div class="fg"><label>Fecha programada</label><input type="date" id="eo-fecha" value="${escAttr(o.fecha)}" ${o.estado==='terminada'?'disabled':''}></div>
      <div class="fg"><label>Turno</label><select id="eo-turno" ${o.estado==='terminada'?'disabled':''}><option value="">Seleccionar...</option>${['Mañana','Tarde','Noche'].map(t=>`<option${o.turno===t?' selected':''}>${t}</option>`).join('')}</select></div>
      <div class="fg"><label>Responsable</label><input type="text" id="eo-resp" value="${escAttr(o.responsable||'')}" ${o.estado==='terminada'?'disabled':''}></div>
      <div class="fg"><label>Equipo asignado</label><input type="text" id="eo-equipo" value="${escAttr(o.equipo||'')}" ${o.estado==='terminada'?'disabled':''}></div>
    </div>
    ${o.estado!=='terminada'&&puedeEstado?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn bsec bsm" onclick="estGuardarCabeceraOrden(${o.id})">💾 Guardar datos</button>
      ${transiciones.map(t=>`<button class="btn ${t==='cancelada'?'bsec':'bp'} bsm" onclick="estCambiarEstadoOrden(${o.id},'${t}')">${lblEstado[t]||t}</button>`).join('')}
    </div>`:''}
    <div class="card-title">Ingredientes teóricos (según receta congelada al crear la orden)</div>
    <div class="table-wrap"><table><thead><tr><th>Ingrediente</th><th>Teórico</th>${o.real?'<th>Real</th><th>Diferencia</th>':''}</tr></thead><tbody>
      ${(o.plan?.ingredientes||[]).map(i=>{
        const r=o.real&&(o.real.consumos||[]).find(c=>c.refId===i.refId);
        const dif=r?r.cantidadBase-i.cantidadBase:null;
        return`<tr><td>${escHtml(i.nombre)}</td><td>${estFmt(i.cantidadBase,i.unidadBase)}</td>${o.real?`<td>${r?estFmt(r.cantidadBase,i.unidadBase):'—'}</td><td style="color:${dif>0?'var(--red)':'var(--green)'}">${dif!=null?(dif>=0?'+':'−')+estFmt(Math.abs(dif),i.unidadBase):'—'}</td>`:''}</tr>`;
      }).join('')}
    </tbody></table></div>
    ${(o.plan?.subrecetas||[]).length?`<div class="card-title" style="margin-top:8px">Subrecetas requeridas</div>
    <div class="table-wrap"><table><thead><tr><th>Subreceta</th><th>Cantidad</th></tr></thead><tbody>
    ${o.plan.subrecetas.map(s=>`<tr><td>${escHtml(s.nombre)}</td><td>${estFmt(s.cantidadBase,s.unidadBase)}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${(snap.version?.pasos||[]).length?`<div class="card-title" style="margin-top:8px">Pasos del proceso</div>
    ${snap.version.pasos.map((p,i)=>`<div class="est-paso-mini"><b>${i+1}. ${escHtml(p.nombre||'Paso')}</b>${p.tiempoMin?` · ${p.tiempoMin} min`:''}${p.tempC?` · ${p.tempC}°C`:''}${p.equipo?` · ${escHtml(p.equipo)}`:''}${p.puntoControl?' · 🔍 punto de control':''}
      ${p.descripcion?`<div>${escHtml(p.descripcion)}</div>`:''}
      ${p.visual?`<div>👁 ${escHtml(p.visual)}</div>`:''}${p.tactil?`<div>✋ ${escHtml(p.tactil)}</div>`:''}${p.riesgos?`<div style="color:var(--red)">⚠ ${escHtml(p.riesgos)}</div>`:''}</div>`).join('')}`:''}
    ${['en_proceso','pausada'].includes(o.estado)&&estPuedeVer('orden.real')?estFormRegistroReal(o):''}
    ${['en_proceso','pausada','terminada'].includes(o.estado)?estSeccionMuestras(o):''}
    ${o.real?estSeccionResultados(o):''}
    ${o.estado==='terminada'?estSeccionCalidad(o):''}
    ${o.estado==='terminada'?estSeccionSensorial(o):''}
    ${o.estado==='terminada'?estSeccionLoteDorado(o):''}
    ${['en_proceso','pausada','terminada'].includes(o.estado)?estSeccionFotos(o):''}
  </div>`;
  el.scrollIntoView({behavior:'smooth'});
}
// ── Lote dorado (resultado ideal de referencia por producto) ──
function estPerfilLote(o){
  const k=o.kpis||{};
  const producto=o.productoId?estProd(o.productoId):null;
  const tol={objetivo:producto?.pesoDespues||producto?.pesoAntes||o.snapshot?.version?.pesoUnidad||null,min:producto?.tolMin||null,max:producto?.tolMax||null};
  const stats=EstCore.statsPesos(o.muestrasPeso||[],tol);
  const sens=EstCore.resumenSensorial((o.sensorial&&o.sensorial.evaluaciones)||[],EstCore.ATRIBUTOS_SENSORIALES);
  return{
    pesoProm:stats?EstCore.redondear(stats.promedio,1):null,
    rendimiento:k.rendimientoPct!=null?EstCore.redondear(k.rendimientoPct,1):null,
    merma:k.mermaPct!=null?EstCore.redondear(k.mermaPct,1):null,
    duracion:k.duracionMin!=null?k.duracionMin:null,
    sensorial:sens.general.promedio!=null?EstCore.redondear(sens.general.promedio,2):null
  };
}
function estSeccionLoteDorado(o){
  const puede=estPuedeVer('calidad.evaluar')||estPuedeVer('receta.aprobar');
  if(o.esLoteDorado){
    return`<div class="card-title" style="margin-top:12px">🏆 Lote dorado</div>
    <div class="est-aviso" style="border-color:var(--gold)">⭐ Este lote es el <b>LOTE DORADO de referencia</b> de este producto${o.doradoDesde?` (desde ${escHtml(String(o.doradoDesde).slice(0,10))})`:''}. Los demás lotes se comparan contra este.</div>
    ${puede?`<button class="btn bsec bsm est-admin-only" onclick="estQuitarDorado(${o.id})">Quitar como lote dorado</button>`:''}`;
  }
  const dorado=(_estCache.est_ordenes||[]).find(x=>x.productoId===o.productoId&&x.esLoteDorado&&x.id!==o.id);
  let comp='<div style="font-size:.78rem;color:var(--gray)">Este producto aún no tiene un lote dorado de referencia.</div>';
  if(dorado){
    const filas=EstCore.compararLoteDorado(estPerfilLote(o),estPerfilLote(dorado));
    comp=`<div style="font-size:.8rem;color:var(--gray);margin:2px 0 6px">Comparación contra el lote dorado <b>${escHtml(dorado.codigo)}</b>:</div>
    <div class="table-wrap"><table><thead><tr><th>Indicador</th><th>Este lote</th><th>Dorado 🏆</th><th>Diferencia</th></tr></thead><tbody>
    ${filas.map(f=>{const buena=(f.clave==='rendimiento'||f.clave==='sensorial')?(f.dif>=0):(f.clave==='merma'||f.clave==='duracion')?(f.dif<=0):null;
      const col=f.dif==null||buena==null?'var(--gray)':buena?'var(--green)':'var(--red)';
      return`<tr><td>${f.label}</td><td>${f.actual??'—'}</td><td>${f.dorado??'—'}</td>
      <td style="color:${col}">${f.dif!=null?((f.dif>0?'+':'')+EstCore.redondear(f.dif,1)+(f.difPct!=null?` (${(f.difPct>0?'+':'')+EstCore.redondear(f.difPct,0)}%)`:'')):'—'}</td></tr>`;}).join('')}
    </tbody></table></div>`;
  }
  return`<div class="card-title" style="margin-top:12px">🏆 Lote dorado</div>${comp}
    ${puede?`<button class="btn bgold bsm est-admin-only" onclick="estMarcarDorado(${o.id})" style="margin-top:6px">🏆 Marcar ESTE como lote dorado</button>`:''}`;
}
async function estMarcarDorado(id){
  if(!estGuard('calidad.evaluar'))return;
  const o=estOrden(id);if(!o)return;
  if(o.productoId==null)return toast('⚠ Este lote no tiene un producto asociado','var(--red)');
  if(!confirm('¿Marcar este lote como el LOTE DORADO (resultado ideal) de este producto? Reemplazará al anterior si existe.'))return;
  for(const x of (_estCache.est_ordenes||[])){
    if(x.productoId===o.productoId&&x.esLoteDorado&&x.id!==id)await dbPut('est_ordenes',{...x,esLoteDorado:false});
  }
  await dbPut('est_ordenes',{...o,esLoteDorado:true,doradoDesde:new Date().toISOString()});
  await estAudit('lote.dorado','est_ordenes',id,null,{producto:o.productoId});
  await estLoad('est_ordenes');
  toast('🏆 Lote dorado actualizado');
  estAbrirOrden(id);
}
async function estQuitarDorado(id){
  if(!estGuard('calidad.evaluar'))return;
  const o=estOrden(id);if(!o)return;
  if(!confirm('¿Quitar este lote como referencia dorada?'))return;
  await dbPut('est_ordenes',{...o,esLoteDorado:false});
  await estAudit('lote.dorado.quitar','est_ordenes',id,null,null);
  await estLoad('est_ordenes');
  estAbrirOrden(id);
}
// ── Fotos / evidencias (subida al servidor, comprimidas en el cliente) ──
// Reduce la imagen antes de subir (menos peso, más rápido en la tablet).
function estComprimirImagen(file,maxLado=1280,calidad=0.82){
  return new Promise((res,rej)=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{URL.revokeObjectURL(url);
      let w=img.width,h=img.height;const esc=Math.min(1,maxLado/Math.max(w,h));
      w=Math.round(w*esc);h=Math.round(h*esc);
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      res(c.toDataURL('image/jpeg',calidad));};
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('No se pudo leer la imagen'));};
    img.src=url;
  });
}
async function estSubirFoto(file,tipo,nota){
  const dataUrl=await estComprimirImagen(file);
  const r=await api('/api/upload',{method:'POST',body:{dataUrl}});
  return{id:r.id,url:r.url,tipo:tipo||'otro',nota:nota||''};
}
const EST_TIPOS_FOTO=[['producto','Producto'],['corte','Corte interno'],['miga','Miga'],['comparativa','Comparativa'],['proceso','Proceso'],['otro','Otro']];
function estSeccionFotos(o){
  const puede=estPuedeVer('calidad.evaluar')||estPuedeVer('orden.real');
  const fotos=o.fotos||[];
  const lbl=t=>(EST_TIPOS_FOTO.find(x=>x[0]===t)||['','Otro'])[1];
  return`<div class="card-title" style="margin-top:12px">📷 Fotos / evidencias</div>
  ${fotos.length?`<div class="est-fotos">${fotos.map(f=>`
    <div class="est-foto">
      <a href="${escAttr(f.url)}" target="_blank" rel="noopener"><img src="${escAttr(f.url)}" alt="${escAttr(lbl(f.tipo))}" loading="lazy"></a>
      <div class="est-foto-cap">${escHtml(lbl(f.tipo))}${f.nota?': '+escHtml(f.nota):''}</div>
      ${puede?`<button class="est-foto-del est-admin-only" title="Borrar" onclick="estBorrarFoto(${o.id},'${escAttr(f.id)}')">✕</button>`:''}
    </div>`).join('')}</div>`:'<div style="font-size:.78rem;color:var(--gray)">Sin fotos todavía. Sube la foto del producto, el corte, la miga…</div>'}
  ${puede?`<div class="fgrid" style="margin-top:8px">
    <div class="fg"><label>Tipo de foto</label><select id="ef-tipo">${EST_TIPOS_FOTO.map(t=>`<option value="${t[0]}">${t[1]}</option>`).join('')}</select></div>
    <div class="fg"><label>Nota (opcional)</label><input type="text" id="ef-nota" placeholder="Ej.: corte a los 5 min"></div>
    <div class="fg"><label>Imagen</label><input type="file" id="ef-file" accept="image/*" capture="environment"></div>
  </div>
  <button class="btn bp bsm" id="ef-btn" onclick="estAgregarFoto(${o.id})">📷 Subir foto</button>`:''}`;
}
async function estAgregarFoto(id){
  if(!estPuedeVer('calidad.evaluar')&&!estPuedeVer('orden.real'))return estGuard('orden.real');
  const o=estOrden(id);if(!o)return;
  const file=document.getElementById('ef-file')?.files?.[0];
  if(!file)return toast('⚠ Elige una imagen','var(--red)');
  const btn=document.getElementById('ef-btn');if(btn){btn.disabled=true;btn.textContent='Subiendo...';}
  try{
    const foto=await estSubirFoto(file,v('ef-tipo'),v('ef-nota').trim());
    const nuevo={...o,fotos:[...(o.fotos||[]),foto],updatedAt:new Date().toISOString()};
    await dbPut('est_ordenes',nuevo);
    await estAudit('foto.agregar','est_ordenes',id,null,{tipo:foto.tipo});
    _estCache.est_ordenes=_estCache.est_ordenes.map(x=>x.id===id?nuevo:x);
    toast('📷 Foto subida');
    estAbrirOrden(id);
  }catch(e){if(btn){btn.disabled=false;btn.textContent='📷 Subir foto';}toast('❌ '+(e?.message||'No se pudo subir la foto'),'var(--red)');}
}
async function estBorrarFoto(id,fotoId){
  if(!estPuedeVer('calidad.evaluar')&&!estPuedeVer('orden.real'))return estGuard('orden.real');
  const o=estOrden(id);if(!o)return;
  if(!confirm('¿Borrar esta foto?'))return;
  try{await api('/api/upload/'+fotoId,{method:'DELETE'});}catch(e){}
  const nuevo={...o,fotos:(o.fotos||[]).filter(f=>f.id!==fotoId),updatedAt:new Date().toISOString()};
  await dbPut('est_ordenes',nuevo);
  _estCache.est_ordenes=_estCache.est_ordenes.map(x=>x.id===id?nuevo:x);
  toast('🗑 Foto borrada','var(--red)');
  estAbrirOrden(id);
}
// ── Evaluación sensorial (ficha con escala y varios catadores) ──
function estSeccionSensorial(o){
  const s=o.sensorial||{escala:5,evaluaciones:[]};
  const escala=Number(s.escala)||5;
  const evals=s.evaluaciones||[];
  const puede=estPuedeVer('calidad.evaluar');
  const resumen=EstCore.resumenSensorial(evals,EstCore.ATRIBUTOS_SENSORIALES);
  const tipos=[['interna_tecnica','Interna técnica'],['consumidor','Consumidor'],['informal','Observación informal'],['oficial','Oficial']];
  const opciones=()=>{let o2='<option value="">—</option>';for(let i=1;i<=escala;i++)o2+=`<option value="${i}">${i}</option>`;return o2;};
  return`<div class="card-title" style="margin-top:12px">👅 Evaluación sensorial</div>
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
    <span style="font-size:.8rem;color:var(--gray)">Escala:</span>
    <select ${puede?`onchange="estSensorialSetEscala(${o.id},this.value)"`:'disabled'} style="padding:6px 10px;border:2px solid var(--cream3);border-radius:var(--r3)">
      <option value="5"${escala===5?' selected':''}>1 a 5</option><option value="7"${escala===7?' selected':''}>1 a 7</option></select>
    <span style="font-size:.8rem;color:var(--gray)">· ${evals.length} evaluación(es)</span>
  </div>
  ${resumen.general.promedio!=null?`<div class="est-stats">
     <div class="est-stat"><div class="est-stat-v" style="color:var(--green)">${EstCore.redondear(resumen.general.promedio,2)} / ${escala}</div><div class="est-stat-l">Puntuación general</div></div>
     <div class="est-stat"><div class="est-stat-v">${resumen.nEvaluaciones}</div><div class="est-stat-l">Catadores</div></div>
   </div>
   <div class="table-wrap"><table><thead><tr><th>Atributo</th><th>Promedio</th><th>Mín/Máx</th><th>Desv.</th><th>N</th></tr></thead><tbody>
   ${resumen.porAtributo.filter(a=>a.n>0).map(a=>`<tr><td>${a.nombre}</td><td><b>${EstCore.redondear(a.promedio,2)}</b></td><td>${a.min} / ${a.max}</td><td>${EstCore.redondear(a.desv,2)}</td><td>${a.n}</td></tr>`).join('')}
   </tbody></table></div>`:'<div style="font-size:.78rem;color:var(--gray)">Aún no hay evaluaciones sensoriales.</div>'}
  ${evals.length?`<div style="margin-top:8px"><div style="font-size:.72rem;font-weight:700;color:var(--brown2);text-transform:uppercase;margin-bottom:4px">Evaluaciones registradas</div>
   ${evals.map((e,i)=>`<div class="est-paso-mini" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
     <span><b>${escHtml(e.evaluador||'—')}</b> · ${escHtml((tipos.find(t=>t[0]===e.tipo)||['',''])[1]||e.tipo||'')} · ${e.fecha?escHtml(String(e.fecha).slice(0,10)):''}${e.comentario?` · 💬 ${escHtml(e.comentario)}`:''}</span>
     ${puede?`<button class="btn br bsm est-admin-only" onclick="estBorrarEvalSensorial(${o.id},${i})">🗑</button>`:''}</div>`).join('')}</div>`:''}
  ${puede?`<div class="card" style="margin:10px 0 0;box-shadow:none;border:1.5px dashed var(--cream3)">
    <div style="font-size:.72rem;font-weight:700;color:var(--brown2);text-transform:uppercase;margin-bottom:8px">Nueva evaluación de un catador</div>
    <div class="fgrid">
      <div class="fg"><label>Catador / evaluador</label><input type="text" id="es-eval" placeholder="Nombre"></div>
      <div class="fg"><label>Tipo</label><select id="es-tipo">${tipos.map(t=>`<option value="${t[0]}">${t[1]}</option>`).join('')}</select></div>
    </div>
    <div class="fgrid">
      ${EstCore.ATRIBUTOS_SENSORIALES.map((a,i)=>`<div class="fg"><label>${a} (1–${escala})</label><select id="es-a-${i}">${opciones()}</select></div>`).join('')}
    </div>
    <div class="fgrid one"><div class="fg"><label>Comentario</label><input type="text" id="es-com" placeholder="Opcional"></div></div>
    <button class="btn bp btn-full" onclick="estAgregarEvalSensorial(${o.id})">➕ Registrar evaluación</button>
  </div>`:''}`;
}
async function estAgregarEvalSensorial(id){
  if(!estGuard('calidad.evaluar'))return;
  const o=estOrden(id);if(!o)return;
  const evaluador=v('es-eval').trim();
  if(!evaluador)return toast('⚠ Escribe el nombre del evaluador','var(--red)');
  const valores={};
  EstCore.ATRIBUTOS_SENSORIALES.forEach((a,i)=>{const val=toNum(v('es-a-'+i));if(val>0)valores[a]=val;});
  if(!Object.keys(valores).length)return toast('⚠ Califica al menos un atributo','var(--red)');
  const s=o.sensorial||{escala:5,evaluaciones:[]};
  const nueva={evaluador,tipo:v('es-tipo'),fecha:new Date().toISOString(),valores,comentario:v('es-com').trim()};
  const nuevo={...o,sensorial:{...s,evaluaciones:[...(s.evaluaciones||[]),nueva]},updatedAt:new Date().toISOString()};
  await dbPut('est_ordenes',nuevo);
  await estAudit('sensorial.agregar','est_ordenes',id,null,{evaluador,tipo:nueva.tipo});
  _estCache.est_ordenes=_estCache.est_ordenes.map(x=>x.id===id?nuevo:x);
  toast('👅 Evaluación registrada');
  estAbrirOrden(id);
}
async function estBorrarEvalSensorial(id,idx){
  if(!estGuard('calidad.evaluar'))return;
  const o=estOrden(id);if(!o||!o.sensorial)return;
  if(!confirm('¿Borrar esta evaluación?'))return;
  const evals=(o.sensorial.evaluaciones||[]).filter((_,i)=>i!==idx);
  const nuevo={...o,sensorial:{...o.sensorial,evaluaciones:evals},updatedAt:new Date().toISOString()};
  await dbPut('est_ordenes',nuevo);
  _estCache.est_ordenes=_estCache.est_ordenes.map(x=>x.id===id?nuevo:x);
  estAbrirOrden(id);
}
async function estSensorialSetEscala(id,val){
  if(!estGuard('calidad.evaluar'))return;
  const o=estOrden(id);if(!o)return;
  const s=o.sensorial||{escala:5,evaluaciones:[]};
  const nuevo={...o,sensorial:{...s,escala:Number(val)||5}};
  await dbPut('est_ordenes',nuevo);
  _estCache.est_ordenes=_estCache.est_ordenes.map(x=>x.id===id?nuevo:x);
  estAbrirOrden(id);
}
async function estGuardarCabeceraOrden(id){
  if(!estGuard('orden.estado'))return;
  const o=estOrden(id);if(!o)return;
  const nuevo={...o,fecha:v('eo-fecha')||o.fecha,turno:v('eo-turno'),responsable:v('eo-resp').trim(),equipo:v('eo-equipo').trim(),updatedAt:new Date().toISOString()};
  await dbPut('est_ordenes',nuevo);
  _estCache.est_ordenes=_estCache.est_ordenes.map(x=>x.id===id?nuevo:x);
  toast('💾 Orden actualizada');
}
async function estCambiarEstadoOrden(id,nuevoEstado){
  if(!estGuard('orden.estado'))return;
  const o=estOrden(id);if(!o)return;
  if(!EstCore.transicionOrdenValida(o.estado,nuevoEstado))return toast(`⛔ Transición no permitida: ${o.estado} → ${nuevoEstado}`,'var(--red)');
  if(nuevoEstado==='cancelada'&&!confirm('¿Cancelar esta orden?'))return;
  await estGuardarCabeceraOrden(id);
  const o2=estOrden(id);
  const nuevo={...o2,estado:nuevoEstado,updatedAt:new Date().toISOString()};
  if(nuevoEstado==='en_proceso'&&!nuevo.horaInicioReal)nuevo.horaInicioReal=new Date().toTimeString().slice(0,5);
  await dbPut('est_ordenes',nuevo);
  await estAudit('orden.estado','est_ordenes',id,{estado:o.estado},{estado:nuevoEstado});
  toast('✅ Orden: '+nuevoEstado);
  await estRenderOrdenes(id);
}
function estFormRegistroReal(o){
  const consumos=(o.plan?.ingredientes||[]);
  return`<div class="card-title" style="margin-top:12px">📝 Registro de producción real</div>
  <div class="fgrid three">
    <div class="fg"><label>Hora inicio</label><input type="time" id="err-ini" value="${escAttr(o.horaInicioReal||'')}"></div>
    <div class="fg"><label>Hora término</label><input type="time" id="err-fin"></div>
    <div class="fg"><label>Unidades producidas (total)</label><input type="number" id="err-prod" min="0" step="1"></div>
    <div class="fg"><label>Unidades buenas</label><input type="number" id="err-buenas" min="0" step="1"></div>
    <div class="fg"><label>Defectuosas</label><input type="number" id="err-def" min="0" step="1" value="0"></div>
    <div class="fg"><label>Quemadas</label><input type="number" id="err-quem" min="0" step="1" value="0"></div>
    <div class="fg"><label>Rotas</label><input type="number" id="err-rotas" min="0" step="1" value="0"></div>
    <div class="fg"><label>Deformadas</label><input type="number" id="err-defo" min="0" step="1" value="0"></div>
    <div class="fg"><label>Para prueba / muestra</label><input type="number" id="err-muestra" min="0" step="1" value="0"></div>
    <div class="fg"><label>Reprocesadas</label><input type="number" id="err-repro" min="0" step="1" value="0"></div>
    <div class="fg"><label>Peso total obtenido (g)</label><input type="number" id="err-peso" min="0" step="any"></div>
    <div class="fg"><label>Masa sobrante (g)</label><input type="number" id="err-sobra" min="0" step="any" value="0"></div>
  </div>
  <div style="font-size:.75rem;font-weight:700;color:var(--brown2);margin:4px 0 8px;text-transform:uppercase">Ingredientes realmente utilizados (g/ml/und):</div>
  ${consumos.map((c,i)=>`<div class="fgrid" style="margin-bottom:4px"><div class="fg"><label>${escHtml(c.nombre)} (teórico: ${estFmt(c.cantidadBase,c.unidadBase)})</label>
    <input type="number" min="0" step="any" id="err-cons-${i}" value="${escAttr(EstCore.redondear(c.cantidadBase,1))}"></div></div>`).join('')}
  <div class="fgrid one"><div class="fg"><label>Incidencias</label><input type="text" id="err-incid" placeholder="Cortes de luz, fallas de horno... (opcional)"></div>
  <div class="fg"><label>Comentarios</label><input type="text" id="err-coment" placeholder="Opcional"></div>
  <div class="fg"><label>Responsable del registro</label><input type="text" id="err-resp" value="${escAttr(o.responsable||'')}"></div></div>
  <button class="btn bg2 btn-full" onclick="estCerrarOrden(${o.id})">✔ Terminar producción y generar lote</button>`;
}
async function estCerrarOrden(id){
  if(!estGuard('orden.real'))return;
  const o=estOrden(id);if(!o)return;
  const real={
    horaInicio:v('err-ini'),horaFin:v('err-fin'),
    producidas:toNum(v('err-prod')),buenas:toNum(v('err-buenas')),defectuosas:toNum(v('err-def')),
    quemadas:toNum(v('err-quem')),rotas:toNum(v('err-rotas')),deformadas:toNum(v('err-defo')),
    muestra:toNum(v('err-muestra')),reprocesadas:toNum(v('err-repro')),
    pesoObtenido:toNum(v('err-peso')),pesoSobrante:toNum(v('err-sobra')),
    incidencias:v('err-incid').trim(),comentarios:v('err-coment').trim(),responsable:v('err-resp').trim(),
    consumos:(o.plan?.ingredientes||[]).map((c,i)=>({refId:c.refId,nombre:c.nombre,unidadBase:c.unidadBase,cantidadBase:toNum(v('err-cons-'+i))}))
  };
  // Validación de coherencia: no se permite cerrar con datos inconsistentes
  const val=EstCore.validarRegistroReal(real);
  if(val.errores.length)return toast('⛔ '+val.errores[0],'var(--red)');
  if(real.consumos.some(c=>c.cantidadBase<0))return toast('⛔ Consumos negativos no permitidos','var(--red)');
  if(val.avisos.length&&!confirm('Avisos:\n- '+val.avisos.join('\n- ')+'\n\n¿Terminar la producción de todos modos?'))return;
  if(!confirm('¿Confirmas terminar esta producción? Los datos quedarán registrados en el histórico.'))return;
  const kpis=EstCore.calcularKpis(o.plan,real);
  // Lote asociado
  const producto=o.productoId?estProd(o.productoId):null;
  const vidaUtil=producto&&producto.vidaUtilDias?producto.vidaUtilDias:null;
  const venc=vidaUtil?new Date(new Date(o.fecha+'T12:00:00').getTime()+vidaUtil*86400000).toISOString().slice(0,10):null;
  const lote={
    codigo:EstCore.genCodigo('LOT',await estSeq('est_lotes'),o.fecha),
    fecha:o.fecha,ordenId:o.id,ordenCodigo:o.codigo,
    productoId:o.productoId,productoNombre:o.snapshot?.producto?.nombre||o.snapshot?.receta?.nombre||'',
    versionNumero:o.versionNumero,responsable:real.responsable,
    cantidadProducida:real.producidas,cantidadAprobada:null,cantidadRechazada:null,
    vencimiento:venc,estado:'pendiente',obs:'',demo:o.demo||false,createdAt:new Date().toISOString()
  };
  const loteId=await dbAdd('est_lotes',lote);
  const nuevo={...o,estado:'terminada',real,kpis,loteId,updatedAt:new Date().toISOString()};
  await dbPut('est_ordenes',nuevo);
  await estAudit('orden.cerrar','est_ordenes',id,{estado:o.estado},{estado:'terminada',kpis},real.incidencias||null);
  await estAudit('lote.crear','est_lotes',loteId,null,{codigo:lote.codigo,producidas:real.producidas});
  toast('✅ Producción terminada. Lote '+lote.codigo+' generado (pendiente de calidad)');
  await estRenderOrdenes(id);
}
function estSeccionResultados(o){
  const k=o.kpis||{};
  const cmp=(lbl,plan,real,unidad)=>`<tr><td>${lbl}</td><td>${plan??'—'}</td><td>${real??'—'}</td><td>${plan!=null&&real!=null?(real-plan>0?'+':'')+EstCore.redondear(real-plan,1)+(unidad||''):'—'}</td></tr>`;
  return`<div class="card-title" style="margin-top:12px">📊 Resultados: planificado vs real</div>
  <div class="est-stats">
    <div class="est-stat"><div class="est-stat-v" style="color:var(--green)">${estFmtPct(k.rendimientoPct)}</div><div class="est-stat-l">Rendimiento (buenas/plan)</div></div>
    <div class="est-stat"><div class="est-stat-v" style="color:var(--orange)">${estFmtPct(k.mermaPct)}</div><div class="est-stat-l">Merma por peso</div></div>
    <div class="est-stat"><div class="est-stat-v">${k.duracionMin!=null?k.duracionMin+' min':'—'}</div><div class="est-stat-l">Tiempo real</div></div>
  </div>
  <div class="table-wrap"><table><thead><tr><th>Indicador</th><th>Plan</th><th>Real</th><th>Diferencia</th></tr></thead><tbody>
    ${cmp('Unidades',EstCore.redondear(k.unidadesPlan,1),k.unidadesReal,' und')}
    ${cmp('Unidades buenas',EstCore.redondear(k.unidadesPlan,1),k.buenas,' und')}
    ${cmp('Peso total (g)',k.pesoTeorico!=null?EstCore.redondear(k.pesoTeorico,1):null,k.pesoObtenido,' g')}
    ${cmp('Tiempo (min)',k.tiempoEsperadoMin,k.duracionMin,' min')}
  </tbody></table></div>
  <div style="font-size:.78rem;color:var(--gray);margin-top:4px">
    Defectuosas: ${o.real.defectuosas||0} · Quemadas: ${o.real.quemadas||0} · Rotas: ${o.real.rotas||0} · Deformadas: ${o.real.deformadas||0} · Muestra: ${o.real.muestra||0} · Reprocesadas: ${o.real.reprocesadas||0} · Masa sobrante: ${estFmt(o.real.pesoSobrante||0,'g')}
    ${o.real.incidencias?`<br>⚠ Incidencias: ${escHtml(o.real.incidencias)}`:''}
    ${o.real.comentarios?`<br>💬 ${escHtml(o.real.comentarios)}`:''}
  </div>`;
}
// ── Control de peso ──
function estSeccionMuestras(o){
  const producto=o.productoId?estProd(o.productoId):null;
  const tol={objetivo:producto?.pesoDespues||producto?.pesoAntes||o.snapshot?.version?.pesoUnidad||null,min:producto?.tolMin||null,max:producto?.tolMax||null};
  const stats=EstCore.statsPesos(o.muestrasPeso||[],tol);
  const puede=estPuedeVer('orden.real')||estPuedeVer('calidad.evaluar');
  return`<div class="card-title" style="margin-top:12px">⚖️ Control de peso ${producto?.muestraRecomendada?`(muestra recomendada: ${producto.muestraRecomendada} und)`:''}</div>
  <div style="font-size:.78rem;color:var(--gray);margin-bottom:6px">Objetivo: ${tol.objetivo??'—'} g · Rango permitido: ${tol.min??'—'} – ${tol.max??'—'} g</div>
  ${puede&&o.estado!=='cancelada'?`<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
    <input type="text" id="em-pesos" placeholder="Pesos en g, separados por coma: 118, 122, 130" style="flex:1;min-width:200px;padding:9px 12px;border:2px solid var(--cream3);border-radius:var(--r3)">
    <button class="btn bp bsm" onclick="estAgregarMuestras(${o.id})">＋ Registrar pesos</button>
    ${(o.muestrasPeso||[]).length?`<button class="btn bsec bsm" onclick="estLimpiarMuestras(${o.id})">Borrar muestras</button>`:''}
  </div>`:''}
  ${stats?`<div class="est-stats">
    <div class="est-stat"><div class="est-stat-v">${stats.n}</div><div class="est-stat-l">Muestras</div></div>
    <div class="est-stat"><div class="est-stat-v">${EstCore.redondear(stats.promedio,1)} g</div><div class="est-stat-l">Promedio</div></div>
    <div class="est-stat"><div class="est-stat-v">${stats.min} / ${stats.max} g</div><div class="est-stat-l">Mín / Máx</div></div>
    <div class="est-stat"><div class="est-stat-v">${stats.desvObjetivo!=null?(stats.desvObjetivo>0?'+':'')+EstCore.redondear(stats.desvObjetivo,1)+' g':'—'}</div><div class="est-stat-l">Desvío vs objetivo</div></div>
    <div class="est-stat"><div class="est-stat-v">${stats.dentro??'—'} / ${stats.fuera??'—'}</div><div class="est-stat-l">Dentro / fuera de rango</div></div>
    <div class="est-stat"><div class="est-stat-v" style="color:${stats.cumplimientoPct!=null&&stats.cumplimientoPct<80?'var(--red)':'var(--green)'}">${estFmtPct(stats.cumplimientoPct)}</div><div class="est-stat-l">Cumplimiento</div></div>
  </div>
  <div style="font-size:.78rem;color:var(--gray)">Pesos registrados: ${(o.muestrasPeso||[]).join(', ')} g</div>`:'<div style="font-size:.78rem;color:var(--gray)">Sin muestras registradas todavía.</div>'}`;
}
async function estAgregarMuestras(id){
  if(!estPuedeVer('orden.real')&&!estPuedeVer('calidad.evaluar'))return estGuard('orden.real');
  const o=estOrden(id);if(!o)return;
  const nuevas=EstCore.parseMuestras(v('em-pesos'));
  if(!nuevas.length)return toast('⚠ Escribe pesos válidos en gramos','var(--red)');
  if(nuevas.some(p=>p>100000))return toast('⚠ Hay pesos fuera de un rango razonable','var(--red)');
  const nuevo={...o,muestrasPeso:[...(o.muestrasPeso||[]),...nuevas],updatedAt:new Date().toISOString()};
  await dbPut('est_ordenes',nuevo);
  await estAudit('orden.muestras','est_ordenes',id,{n:(o.muestrasPeso||[]).length},{n:nuevo.muestrasPeso.length});
  _estCache.est_ordenes=_estCache.est_ordenes.map(x=>x.id===id?nuevo:x);
  toast('⚖️ '+nuevas.length+' peso(s) registrado(s)');
  estAbrirOrden(id);
}
async function estLimpiarMuestras(id){
  const o=estOrden(id);if(!o)return;
  if(!confirm('¿Borrar todas las muestras de peso de esta orden?'))return;
  const nuevo={...o,muestrasPeso:[],updatedAt:new Date().toISOString()};
  await dbPut('est_ordenes',nuevo);
  _estCache.est_ordenes=_estCache.est_ordenes.map(x=>x.id===id?nuevo:x);
  estAbrirOrden(id);
}
// ── Control de calidad ──
function estSeccionCalidad(o){
  const lote=(_estCache.est_lotes||[]).find(l=>l.id===o.loteId);
  const cal=o.calidad||{criterios:EST_CRITERIOS_CALIDAD.map(n=>({nombre:n,resultado:'na'})),resultado:null,evaluadoPor:''};
  const puede=estPuedeVer('calidad.evaluar');
  const cerrado=lote&&lote.estado!=='pendiente';
  return`<div class="card-title" style="margin-top:12px">🔍 Control de calidad — Lote ${escHtml(lote?lote.codigo:'—')} ${lote?estBadge(lote.estado):''}</div>
  <div class="table-wrap"><table><thead><tr><th>Criterio</th><th>Cumple</th><th>No cumple</th><th>No aplica</th></tr></thead><tbody>
  ${cal.criterios.map((c,i)=>`<tr><td>${escHtml(c.nombre)}</td>
    ${['si','no','na'].map(val=>`<td style="text-align:center"><input type="radio" name="eq-${i}" value="${val}" ${c.resultado===val?'checked':''} ${puede&&!cerrado?'':'disabled'}></td>`).join('')}</tr>`).join('')}
  </tbody></table></div>
  ${puede&&!cerrado?`<div class="fgrid" style="margin-top:8px">
    <div class="fg"><label>Resultado del lote</label><select id="eq-res">
      <option value="">Seleccionar...</option>
      <option value="aprobado">✅ Aprobado</option><option value="aprobado_obs">🟡 Aprobado con observaciones</option>
      <option value="retenido">🟠 Retenido</option><option value="rechazado">🔴 Rechazado</option></select></div>
    <div class="fg"><label>Unidades aprobadas</label><input type="number" id="eq-apro" min="0" step="1" value="${escAttr(o.real?.buenas??'')}"></div>
    <div class="fg"><label>Unidades rechazadas</label><input type="number" id="eq-rech" min="0" step="1" value="${escAttr((o.real?(o.real.producidas-(o.real.buenas||0)):0)||0)}"></div>
    <div class="fg"><label>Evaluado por</label><input type="text" id="eq-eval" value="${escAttr(cal.evaluadoPor||'')}"></div>
    <div class="fg fgrid one"><label>Observaciones</label><input type="text" id="eq-obs" value="${escAttr(lote?.obs||'')}"></div>
  </div>
  <button class="btn bg2 btn-full" onclick="estResolverLote(${o.id})">✔ Registrar evaluación del lote</button>`:
  (cal.resultado?`<div style="font-size:.78rem;color:var(--gray);margin-top:6px">Evaluado por ${escHtml(cal.evaluadoPor||'—')} · Aprobado por ${escHtml(cal.aprobadoPor||'—')} ${lote?.obs?'· '+escHtml(lote.obs):''}</div>`:'')}`;
}
async function estResolverLote(ordenId){
  if(!estGuard('lote.resolver'))return;
  const o=estOrden(ordenId);if(!o)return;
  const lote=(_estCache.est_lotes||[]).find(l=>l.id===o.loteId);if(!lote)return;
  const resultado=v('eq-res');
  if(!resultado)return toast('⚠ Selecciona el resultado del lote','var(--red)');
  const apro=toNum(v('eq-apro')),rech=toNum(v('eq-rech'));
  if(apro<0||rech<0)return toast('⛔ Cantidades negativas no permitidas','var(--red)');
  if(apro+rech>(o.real?.producidas||0))return toast('⛔ Aprobadas + rechazadas supera lo producido','var(--red)');
  const criterios=EST_CRITERIOS_CALIDAD.map((n,i)=>({nombre:n,resultado:(document.querySelector(`input[name="eq-${i}"]:checked`)||{}).value||'na'}));
  if(!confirm(`¿Registrar el lote como "${resultado}"? Esta decisión queda en el histórico.`))return;
  const calidad={criterios,resultado,evaluadoPor:v('eq-eval').trim(),aprobadoPor:estRol(),fecha:new Date().toISOString()};
  const nuevoLote={...lote,estado:resultado,cantidadAprobada:apro,cantidadRechazada:rech,obs:v('eq-obs').trim(),updatedAt:new Date().toISOString()};
  await dbPut('est_lotes',nuevoLote);
  await dbPut('est_ordenes',{...o,calidad,updatedAt:new Date().toISOString()});
  await estAudit('lote.resolver','est_lotes',lote.id,{estado:lote.estado},{estado:resultado,aprobadas:apro,rechazadas:rech},v('eq-obs').trim());
  toast('✅ Lote '+lote.codigo+': '+resultado);
  await estRenderOrdenes(ordenId);
}
// ── Vista imprimible ──
function estImprimirOrden(id){
  const o=estOrden(id);if(!o)return;
  const snap=o.snapshot||{};
  const div=document.getElementById('est-print');
  div.innerHTML=`
  <h2>Pan Control — Orden de producción ${escHtml(o.codigo)}</h2>
  <p><b>${escHtml(snap.producto?.nombre||snap.receta?.nombre||'')}</b> — receta v${o.versionNumero} · Fecha: ${fmt(o.fecha)} · Turno: ${escHtml(o.turno||'—')} · Responsable: ${escHtml(o.responsable||'—')}</p>
  <p>Plan: <b>${EstCore.redondear(o.plan?.unidades||0,1)} ${snap.version?.salida?.unidad||''}</b>${o.plan?.pesoTotalEsperado?` · Peso esperado: ${estFmt(o.plan.pesoTotalEsperado,'g')}`:''}${o.plan?.bandejas?` · Bandejas: ${o.plan.bandejas}`:''}${o.plan?.tandas?` · Tandas: ${o.plan.tandas}`:''}</p>
  <h3>Ingredientes</h3>
  <table border="1" cellspacing="0" cellpadding="4"><tr><th>Ingrediente</th><th>Cantidad</th></tr>
  ${(o.plan?.ingredientes||[]).map(i=>`<tr><td>${escHtml(i.nombre)}</td><td>${estFmt(i.cantidadBase,i.unidadBase)}</td></tr>`).join('')}</table>
  ${(o.plan?.subrecetas||[]).length?`<h3>Subrecetas</h3><table border="1" cellspacing="0" cellpadding="4"><tr><th>Subreceta</th><th>Cantidad</th></tr>${o.plan.subrecetas.map(s=>`<tr><td>${escHtml(s.nombre)}</td><td>${estFmt(s.cantidadBase,s.unidadBase)}</td></tr>`).join('')}</table>`:''}
  ${(snap.version?.pasos||[]).length?`<h3>Pasos</h3><ol>${snap.version.pasos.map(p=>`<li><b>${escHtml(p.nombre||'')}</b>${p.tiempoMin?` — ${p.tiempoMin} min`:''}${p.tempC?` — ${p.tempC}°C`:''}${p.descripcion?`<br>${escHtml(p.descripcion)}`:''}${p.visual?`<br>Señal visual: ${escHtml(p.visual)}`:''}${p.tactil?`<br>Señal táctil: ${escHtml(p.tactil)}`:''}</li>`).join('')}</ol>`:''}
  ${snap.version?.obs?`<h3>Observaciones técnicas</h3><p>${escHtml(snap.version.obs)}</p>`:''}
  <p style="margin-top:20px">Firma responsable: ______________________ &nbsp;&nbsp; Firma calidad: ______________________</p>`;
  window.print();
}

// ════════════════════════════════════════════════════════════════
// RESPALDO E IMPORTACIÓN DEL MÓDULO
// ════════════════════════════════════════════════════════════════
async function estExportarModulo(){
  if(!estGuard('exportar'))return;
  const data={version:1,modulo:'produccion_estandarizacion',fecha:new Date().toISOString()};
  // ?all=1: respaldo COMPLETO de todas las organizaciones (solo admin). Sin este
  // flag el servidor limitaría la lectura a la organización activa.
  for(const s of EST_STORES)data[s]=await api('/api/store/'+s+'?all=1');
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`PanControl_Produccion_${hoy()}.json`;a.click();URL.revokeObjectURL(a.href);
  toast('💾 Respaldo del módulo descargado');
}
async function estImportarModulo(input){
  if(!estGuard('config')){input.value='';return}
  const file=input.files[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.modulo!=='produccion_estandarizacion')return toast('❌ El archivo no es un respaldo de este módulo','var(--red)');
    if(!confirm(`¿Importar respaldo del ${String(data.fecha||'').slice(0,10)}? Solo se agregan registros que no existan.`)){input.value='';return}
    let total=0;
    for(const s of EST_STORES){
      const rows=data[s]||[];const existing=await api('/api/store/'+s+'?all=1');const ids=new Set(existing.map(r=>r.id));
      for(const row of rows){if(!ids.has(row.id)){await api('/api/store/'+s+'?all=1',{method:'POST',body:(({id,...rest})=>rest)(row)});total++}}
    }
    await estAudit('modulo.importar','modulo',null,null,{registros:total});
    toast(`✅ ${total} registro(s) importados`);
    estRenderPanel();
  }catch(e){toast('❌ Error al importar: '+e.message,'var(--red)')}
  input.value='';
}

// ════════════════════════════════════════════════════════════════
// DATOS DE DEMOSTRACIÓN (FICTICIOS)
// ════════════════════════════════════════════════════════════════
async function estCargarDemo(){
  if(!estGuard('demo.cargar'))return;
  const ya=(await dbAll('est_ingredientes')).some(i=>i.demo);
  if(ya)return toast('⚠ Los datos de demostración ya fueron cargados','var(--red)');
  if(!confirm('Se cargarán datos de DEMOSTRACIÓN claramente marcados como [DEMO].\nSon valores ficticios para probar el sistema; NO son fórmulas reales de la panadería.\n\n¿Continuar?'))return;
  const ahora=new Date().toISOString();
  const mk=async(store,rec)=>await dbAdd(store,{...rec,demo:true,createdAt:ahora,updatedAt:ahora});
  // Ingredientes ficticios
  const harina=await mk('est_ingredientes',{codigo:'ING-DEMO-1',nombre:'Harina de trigo [DEMO]',categoria:'Harinas',unidadBase:'g',presentaciones:[{nombre:'Saco proveedor A',factorBase:50000},{nombre:'Saco proveedor B',factorBase:40000}],estado:'activo',alergenos:'Gluten'});
  const agua=await mk('est_ingredientes',{codigo:'ING-DEMO-2',nombre:'Agua [DEMO]',categoria:'Líquidos',unidadBase:'ml',presentaciones:[],estado:'activo'});
  const azucar=await mk('est_ingredientes',{codigo:'ING-DEMO-3',nombre:'Azúcar [DEMO]',categoria:'Endulzantes',unidadBase:'g',presentaciones:[{nombre:'Bolsa 1kg',factorBase:1000}],estado:'activo'});
  const sal=await mk('est_ingredientes',{codigo:'ING-DEMO-4',nombre:'Sal [DEMO]',categoria:'Condimentos',unidadBase:'g',presentaciones:[],estado:'activo'});
  const levadura=await mk('est_ingredientes',{codigo:'ING-DEMO-5',nombre:'Levadura [DEMO]',categoria:'Fermentos',unidadBase:'g',presentaciones:[{nombre:'Paquete 500g',factorBase:500}],estado:'activo'});
  const marg=await mk('est_ingredientes',{codigo:'ING-DEMO-6',nombre:'Margarina [DEMO]',categoria:'Grasas',unidadBase:'g',presentaciones:[{nombre:'Caja 10kg',factorBase:10000}],estado:'activo'});
  const queso=await mk('est_ingredientes',{codigo:'ING-DEMO-7',nombre:'Queso fresco [DEMO]',categoria:'Lácteos',unidadBase:'g',presentaciones:[],estado:'activo',alergenos:'Lácteos'});
  const bolsa=await mk('est_ingredientes',{codigo:'ING-DEMO-8',nombre:'Bolsa de empaque [DEMO]',categoria:'Empaque',unidadBase:'und',presentaciones:[{nombre:'Paquete 100 und',factorBase:100}],estado:'activo'});
  const etiqueta=await mk('est_ingredientes',{codigo:'ING-DEMO-9',nombre:'Etiqueta [DEMO]',categoria:'Empaque',unidadBase:'und',presentaciones:[],estado:'activo'});
  // Producto final ficticio
  const prodId=await mk('est_productos',{codigo:'PRD-DEMO-1',nombre:'Empanada de queso [DEMO]',categoria:'Empanadas',descripcion:'Producto de demostración',pesoAntes:120,pesoDespues:115,tolMin:110,tolMax:125,unidadVenta:'unidad',vidaUtilDias:3,conservacion:'Ambiente fresco',porBandeja:20,porLote:100,muestraRecomendada:5,estado:'aprobado'});
  // Subreceta: masa base
  const recMasa=await mk('est_recetas',{nombre:'Masa base [DEMO]',tipo:'sub',productoId:null});
  await mk('est_versiones',{recetaId:recMasa,numero:1,estado:'aprobada',responsable:'María (demo)',motivo:'Versión inicial',fechaAprobacion:ahora,aprobadoPor:'admin',
    salida:{cantidad:10000,unidad:'g'},pesoUnidad:null,tiempoEsperadoMin:90,
    obs:'DEMO — La masa debe verse lisa y elástica; al estirarla debe formar una membrana fina sin romperse. Aroma suave a fermento.',
    componentes:[
      {tipo:'ing',refId:harina,nombre:'Harina de trigo [DEMO]',unidadBase:'g',cantidad:5600,cantidadBase:5600,cantidadIngreso:5.6,unidadIngreso:'kg',esBase:true,orden:1,mermaPct:1,obligatorio:true,indicaciones:'Tamizar antes de usar'},
      {tipo:'ing',refId:agua,nombre:'Agua [DEMO]',unidadBase:'ml',cantidad:3080,cantidadBase:3080,cantidadIngreso:3.08,unidadIngreso:'L',esBase:false,orden:2,mermaPct:0,obligatorio:true,indicaciones:'Agua fría en verano'},
      {tipo:'ing',refId:azucar,nombre:'Azúcar [DEMO]',unidadBase:'g',cantidad:560,cantidadBase:560,cantidadIngreso:560,unidadIngreso:'g',esBase:false,orden:3,mermaPct:0,obligatorio:true},
      {tipo:'ing',refId:marg,nombre:'Margarina [DEMO]',unidadBase:'g',cantidad:448,cantidadBase:448,cantidadIngreso:448,unidadIngreso:'g',esBase:false,orden:4,mermaPct:0,obligatorio:true,indicaciones:'Incorporar al final del amasado'},
      {tipo:'ing',refId:sal,nombre:'Sal [DEMO]',unidadBase:'g',cantidad:112,cantidadBase:112,cantidadIngreso:112,unidadIngreso:'g',esBase:false,orden:5,mermaPct:0,obligatorio:true,indicaciones:'No poner en contacto directo con la levadura'},
      {tipo:'ing',refId:levadura,nombre:'Levadura [DEMO]',unidadBase:'g',cantidad:84,cantidadBase:84,cantidadIngreso:84,unidadIngreso:'g',esBase:false,orden:6,mermaPct:0,obligatorio:true}
    ],
    pasos:[
      {n:1,nombre:'Pesado',descripcion:'Pesar todos los ingredientes según la orden',tiempoMin:10,puntoControl:true,visual:'',tactil:'',riesgos:'Errores de pesado cambian toda la receta'},
      {n:2,nombre:'Mezclado',descripcion:'Mezclar secos, agregar agua poco a poco',tiempoMin:8,equipo:'Mezcladora',velocidad:'1',visual:'Masa integrada sin grumos',tactil:''},
      {n:3,nombre:'Amasado',descripcion:'Amasar hasta desarrollo completo del gluten',tiempoMin:12,equipo:'Amasadora',velocidad:'2',capacidadMax:15000,visual:'Superficie lisa y brillante',tactil:'Elástica, forma membrana fina',riesgos:'Sobre-amasado la vuelve pegajosa',puntoControl:true},
      {n:4,nombre:'Reposo',descripcion:'Reposar tapada',tiempoMin:20,visual:'Duplica volumen aprox.',tactil:'Al presionar, recupera lentamente'}
    ]});
  // Subreceta: relleno
  const recRelleno=await mk('est_recetas',{nombre:'Relleno de queso [DEMO]',tipo:'sub',productoId:null});
  await mk('est_versiones',{recetaId:recRelleno,numero:1,estado:'aprobada',responsable:'María (demo)',motivo:'Versión inicial',fechaAprobacion:ahora,aprobadoPor:'admin',
    salida:{cantidad:5000,unidad:'g'},pesoUnidad:null,tiempoEsperadoMin:15,
    obs:'DEMO — El relleno debe quedar cremoso, sin líquido suelto.',
    componentes:[{tipo:'ing',refId:queso,nombre:'Queso fresco [DEMO]',unidadBase:'g',cantidad:5000,cantidadBase:5000,cantidadIngreso:5,unidadIngreso:'kg',esBase:true,orden:1,mermaPct:2,obligatorio:true,indicaciones:'Desmenuzar fino'}],
    pasos:[{n:1,nombre:'Preparación',descripcion:'Desmenuzar y homogeneizar el queso',tiempoMin:15,visual:'Textura uniforme'}]});
  // Receta del producto final (aprobada)
  const recEmp=await mk('est_recetas',{nombre:'Empanada de queso [DEMO]',tipo:'producto',productoId:prodId});
  const verEmpId=await mk('est_versiones',{recetaId:recEmp,numero:1,estado:'aprobada',responsable:'María (demo)',motivo:'Versión inicial',fechaAprobacion:ahora,aprobadoPor:'admin',
    salida:{cantidad:100,unidad:'und'},pesoUnidad:115,tiempoEsperadoMin:120,
    obs:'DEMO — Sellar bien los bordes; el barniz debe ser uniforme para un dorado parejo.',
    componentes:[
      {tipo:'sub',refId:recMasa,nombre:'Masa base [DEMO]',unidadBase:'g',cantidad:7000,cantidadBase:7000,cantidadIngreso:7,unidadIngreso:'kg',esBase:false,orden:1,mermaPct:0,obligatorio:true,indicaciones:'70 g por unidad'},
      {tipo:'sub',refId:recRelleno,nombre:'Relleno de queso [DEMO]',unidadBase:'g',cantidad:4500,cantidadBase:4500,cantidadIngreso:4.5,unidadIngreso:'kg',esBase:false,orden:2,mermaPct:0,obligatorio:true,indicaciones:'45 g por unidad'},
      {tipo:'ing',refId:bolsa,nombre:'Bolsa de empaque [DEMO]',unidadBase:'und',cantidad:100,cantidadBase:100,cantidadIngreso:100,unidadIngreso:'und',esBase:false,orden:3,mermaPct:0,obligatorio:true},
      {tipo:'ing',refId:etiqueta,nombre:'Etiqueta [DEMO]',unidadBase:'und',cantidad:100,cantidadBase:100,cantidadIngreso:100,unidadIngreso:'und',esBase:false,orden:4,mermaPct:0,obligatorio:true}
    ],
    pasos:[
      {n:1,nombre:'División',descripcion:'Dividir la masa en piezas de 70 g',tiempoMin:20,puntoControl:true,visual:'',tactil:'',riesgos:'Dividir "al cálculo" produce pesos desiguales: pesar cada pieza'},
      {n:2,nombre:'Rellenado',descripcion:'Colocar 45 g de relleno por pieza',tiempoMin:25,puntoControl:true},
      {n:3,nombre:'Formado',descripcion:'Cerrar y sellar bordes (repulgue)',tiempoMin:20,visual:'Borde sellado sin aberturas'},
      {n:4,nombre:'Horneado',descripcion:'Hornear hasta dorado uniforme',tiempoMin:18,tempC:180,equipo:'Horno rotativo',capacidadMax:200,visual:'Dorado parejo, sin zonas pálidas',riesgos:'Exceso de horno seca el relleno',puntoControl:true},
      {n:5,nombre:'Enfriado',descripcion:'Enfriar sobre rejilla',tiempoMin:20},
      {n:6,nombre:'Empacado',descripcion:'Embolsar y etiquetar',tiempoMin:15}
    ]});
  // Orden de ejemplo terminada con registro real, muestras y lote
  await estLoad(...EST_STORES);
  const vr=(_estCache.est_versiones||[]).find(x=>x.id===verEmpId);
  const producto=estProd(prodId);
  const vCalc={...vr,componentes:vr.componentes.map(c=>({...c,cantidad:c.cantidadBase}))};
  const calc=EstCore.calcularPorUnidades(vCalc,200,estResolver,producto);
  const real={horaInicio:'06:00',horaFin:'08:45',producidas:200,buenas:190,defectuosas:5,quemadas:3,rotas:0,deformadas:0,muestra:2,reprocesadas:0,
    pesoObtenido:22400,pesoSobrante:350,incidencias:'',comentarios:'Producción de demostración (datos ficticios)',responsable:'María (demo)',
    consumos:calc.ingredientes.map(i=>({refId:i.refId,nombre:i.nombre,unidadBase:i.unidadBase,cantidadBase:EstCore.redondear(i.cantidadBase*1.01,1)}))};
  const plan={unidades:200,factor:calc.factor,pesoTotalEsperado:calc.pesoTotalEsperado,bandejas:calc.bandejas,tandas:calc.tandas,tiempoEsperadoMin:120,
    ingredientes:calc.ingredientes,subrecetas:calc.subrecetas};
  const kpis=EstCore.calcularKpis(plan,real);
  const ordenId=await mk('est_ordenes',{codigo:EstCore.genCodigo('OP',await estSeq('est_ordenes'),hoy()),
    recetaId:recEmp,versionId:verEmpId,versionNumero:1,productoId:prodId,
    snapshot:EstCore.snapshotVersion(vr,estRec(recEmp),producto),
    plan,fecha:hoy(),turno:'Mañana',responsable:'María (demo)',equipo:'Horno rotativo',
    estado:'terminada',real,kpis,muestrasPeso:[118,122,130,116,113],calidad:null,loteId:null});
  const loteId=await mk('est_lotes',{codigo:EstCore.genCodigo('LOT',await estSeq('est_lotes'),hoy()),fecha:hoy(),ordenId,ordenCodigo:'OP demo',
    productoId:prodId,productoNombre:'Empanada de queso [DEMO]',versionNumero:1,responsable:'María (demo)',
    cantidadProducida:200,cantidadAprobada:null,cantidadRechazada:null,vencimiento:null,estado:'pendiente',obs:''});
  const oDemo=(await dbAll('est_ordenes')).find(x=>x.id===ordenId);
  await dbPut('est_ordenes',{...oDemo,loteId});
  await estAudit('demo.cargar','modulo',null,null,{nota:'Datos ficticios de demostración cargados'});
  toast('🧪 Datos de demostración cargados');
  estRenderPanel();
}

// ════════════════════════════════════════════════════════════════
// NAVEGACIÓN DEL MÓDULO
// ════════════════════════════════════════════════════════════════
function estSwitchTab(tab,el){
  switchTab('est',tab,el);
  ({panel:estRenderPanel,ing:estRenderIngredientes,prod:estRenderProductos,rec:estRenderRecetas,calc:estRenderCalc,ord:estRenderOrdenes})[tab]?.();
}
