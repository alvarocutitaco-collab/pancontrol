// ════════════════════════════════════════════════════════════════
// PAN CONTROL — PRODUCCIÓN Y ESTANDARIZACIÓN — NÚCLEO DE DOMINIO
// Lógica pura, sin DOM ni IndexedDB. Portable a otros proyectos.
// Se carga en navegador (window.EstCore) y en Node (module.exports)
// para poder ejecutar pruebas automatizadas.
//
// Convenciones de unidades:
//  - Toda cantidad se guarda internamente en UNIDAD BASE:
//      masa    → gramos      ('g')
//      volumen → mililitros  ('ml')
//      conteo  → unidades    ('und')
//  - Las presentaciones (saco, lata, paquete...) son configurables
//    por ingrediente: {nombre, factorBase} (1 presentación = factorBase
//    unidades base). NUNCA se asume que un saco pesa siempre lo mismo.
//  - No se redondea durante los cálculos; solo al mostrar
//    (ver redondear / fmtCantidad).
// ════════════════════════════════════════════════════════════════
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.EstCore=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

// ── Unidades ────────────────────────────────────────────────────
const UNIDADES_BASE={g:'gramos',ml:'mililitros',und:'unidades'};
// Conversiones estándar hacia unidad base (no configurables porque son físicas)
const CONV_ESTANDAR={
  g:{base:'g',factor:1},      gramo:{base:'g',factor:1},      gramos:{base:'g',factor:1},
  kg:{base:'g',factor:1000},  kilo:{base:'g',factor:1000},    kilogramo:{base:'g',factor:1000}, kilogramos:{base:'g',factor:1000},
  ml:{base:'ml',factor:1},    mililitro:{base:'ml',factor:1}, mililitros:{base:'ml',factor:1},
  l:{base:'ml',factor:1000},  litro:{base:'ml',factor:1000},  litros:{base:'ml',factor:1000},
  und:{base:'und',factor:1},  unidad:{base:'und',factor:1},   unidades:{base:'und',factor:1},
  docena:{base:'und',factor:12}, docenas:{base:'und',factor:12}
};
function normUnidad(u){return String(u||'').trim().toLowerCase()}

// Convierte una cantidad expresada en `unidad` a la unidad base del ingrediente.
// `presentaciones`: [{nombre:'Saco 40kg', factorBase:40000}, ...] configurables.
// Devuelve {ok, cantidadBase, error}
function aBase(cantidad,unidad,unidadBase,presentaciones){
  const n=Number(cantidad);
  if(!Number.isFinite(n)||n<0)return{ok:false,error:'Cantidad inválida'};
  const u=normUnidad(unidad);
  const std=CONV_ESTANDAR[u];
  if(std){
    if(std.base!==unidadBase)return{ok:false,error:`La unidad "${unidad}" no corresponde a la unidad base "${unidadBase}"`};
    return{ok:true,cantidadBase:n*std.factor};
  }
  const pres=(presentaciones||[]).find(p=>normUnidad(p.nombre)===u);
  if(pres&&Number(pres.factorBase)>0)return{ok:true,cantidadBase:n*Number(pres.factorBase)};
  return{ok:false,error:`Unidad o presentación desconocida: "${unidad}"`};
}
// Convierte desde unidad base hacia otra unidad/presentación.
function deBase(cantidadBase,unidad,unidadBase,presentaciones){
  const n=Number(cantidadBase);
  if(!Number.isFinite(n))return{ok:false,error:'Cantidad inválida'};
  const u=normUnidad(unidad);
  const std=CONV_ESTANDAR[u];
  if(std&&std.base===unidadBase)return{ok:true,cantidad:n/std.factor};
  const pres=(presentaciones||[]).find(p=>normUnidad(p.nombre)===u);
  if(pres&&Number(pres.factorBase)>0)return{ok:true,cantidad:n/Number(pres.factorBase)};
  return{ok:false,error:`Unidad o presentación desconocida: "${unidad}"`};
}

// Redondeo controlado SOLO para presentación final.
function redondear(x,dp=2){
  const f=Math.pow(10,dp);
  return Math.round((Number(x)+Number.EPSILON)*f)/f;
}
// Presentación práctica: 1520 g → "1.52 kg"; 300 g → "300 g".
function fmtCantidad(cantidadBase,unidadBase){
  const n=Number(cantidadBase)||0;
  if(unidadBase==='g') return n>=1000?redondear(n/1000,3)+' kg':redondear(n,1)+' g';
  if(unidadBase==='ml')return n>=1000?redondear(n/1000,3)+' L':redondear(n,1)+' ml';
  return redondear(n,2)+' und';
}

// ── Porcentaje panadero ─────────────────────────────────────────
// El usuario define cuál componente es la base (esBase=true).
// No se asume que siempre sea harina. Devuelve copia con `porcentaje`.
function calcularPorcentajes(componentes){
  const comps=(componentes||[]).map(c=>({...c}));
  const base=comps.find(c=>c.esBase&&Number(c.cantidad)>0);
  comps.forEach(c=>{
    c.porcentaje=base?redondear(Number(c.cantidad)/Number(base.cantidad)*100,2):null;
  });
  return comps;
}

// ── Estados y transiciones controladas ──────────────────────────
const ESTADOS_VERSION=['borrador','en_prueba','aprobada','reemplazada','archivada'];
const ESTADOS_ORDEN=['borrador','programada','en_proceso','pausada','terminada','cancelada','rechazada'];
const ESTADOS_LOTE=['pendiente','aprobado','aprobado_obs','retenido','rechazado'];
const ESTADOS_PRODUCTO=['desarrollo','prueba','aprobado','suspendido','descontinuado'];
const TRANSICIONES_VERSION={
  borrador:['en_prueba','aprobada','archivada'],
  en_prueba:['borrador','aprobada','archivada'],
  aprobada:['reemplazada','archivada'],
  reemplazada:[],archivada:[]
};
const TRANSICIONES_ORDEN={
  borrador:['programada','cancelada'],
  programada:['en_proceso','cancelada'],
  en_proceso:['pausada','terminada','cancelada'],
  pausada:['en_proceso','cancelada'],
  terminada:[],cancelada:[],rechazada:[]
};
// Una versión SOLO es editable en borrador o en prueba. Una receta
// aprobada nunca se modifica: se crea una nueva versión.
function puedeEditarVersion(estado){return estado==='borrador'||estado==='en_prueba'}
function transicionVersionValida(de,a){return(TRANSICIONES_VERSION[de]||[]).includes(a)}
function transicionOrdenValida(de,a){return(TRANSICIONES_ORDEN[de]||[]).includes(a)}

// ── Validación de versión de receta ─────────────────────────────
// version = {salida:{cantidad,unidad}, pesoUnidad?, componentes:[...], pasos:[...]}
function validarVersion(v){
  const errores=[];
  if(!v)return['Versión vacía'];
  if(!v.salida||!(Number(v.salida.cantidad)>0))errores.push('La salida esperada por lote debe ser mayor que cero');
  if(v.salida&&!UNIDADES_BASE[v.salida.unidad])errores.push('Unidad de salida inválida (usa g, ml o und)');
  const comps=v.componentes||[];
  if(!comps.length)errores.push('La receta debe tener al menos un componente');
  comps.forEach((c,i)=>{
    if(!c.refId&&c.refId!==0)errores.push(`Componente ${i+1}: falta el ingrediente o subreceta`);
    if(!(Number(c.cantidad)>0))errores.push(`Componente ${i+1}: la cantidad debe ser mayor que cero`);
    if(c.mermaPct!=null&&(Number(c.mermaPct)<0||Number(c.mermaPct)>=100))errores.push(`Componente ${i+1}: merma estimada fuera de rango (0–99%)`);
  });
  if(comps.filter(c=>c.esBase).length>1)errores.push('Solo puede haber un componente base para porcentajes');
  return errores;
}

// ── Prevención de ciclos entre subrecetas ───────────────────────
// resolver(recetaId) → lista de componentes de la versión vigente de esa receta.
// Devuelve true si agregar `componentes` a `recetaId` crearía un ciclo.
function creaCiclo(recetaId,componentes,resolver,_vistos){
  const vistos=_vistos||new Set([String(recetaId)]);
  for(const c of (componentes||[])){
    if(c.tipo!=='sub')continue;
    const id=String(c.refId);
    if(vistos.has(id))return true;
    vistos.add(id);
    if(creaCiclo(recetaId,(resolver(c.refId)||[]),resolver,vistos))return true;
    vistos.delete(id);
  }
  return false;
}

// ── Expansión de requerimientos (BOM multinivel) ────────────────
// Expande recursivamente subrecetas hasta llegar a ingredientes.
// factor: cuántos "lotes" de la versión se necesitan (puede ser fraccional).
// resolver(recetaId) → {version, receta} de la versión a usar de la subreceta.
// Aplica merma estimada de cada componente: cantidad*(1+mermaPct/100).
// Devuelve {ingredientes:Map(refId→{cantidadBase,...}), subrecetas:[...], errores:[]}
const MAX_NIVEL=10;
function expandirRequerimientos(version,factor,resolver,nivel=0,acc){
  const out=acc||{ingredientes:new Map(),subrecetas:[],errores:[]};
  if(nivel>MAX_NIVEL){out.errores.push('Demasiados niveles de subrecetas (posible ciclo)');return out}
  for(const c of (version.componentes||[])){
    const merma=1+(Number(c.mermaPct)||0)/100;
    const req=Number(c.cantidad)*factor*merma;
    if(c.tipo==='sub'){
      const sub=resolver?resolver(c.refId):null;
      if(!sub||!sub.version){out.errores.push(`Subreceta no encontrada (id ${c.refId})`);continue}
      const salidaSub=Number(sub.version.salida&&sub.version.salida.cantidad)||0;
      if(!(salidaSub>0)){out.errores.push(`Subreceta "${sub.receta&&sub.receta.nombre||c.refId}" sin salida definida`);continue}
      const factorSub=req/salidaSub;
      out.subrecetas.push({refId:c.refId,nombre:(sub.receta&&sub.receta.nombre)||c.nombre||'',cantidadBase:req,unidadBase:sub.version.salida.unidad,lotes:factorSub,nivel:nivel+1});
      expandirRequerimientos(sub.version,factorSub,resolver,nivel+1,out);
    }else{
      const prev=out.ingredientes.get(c.refId)||{refId:c.refId,nombre:c.nombre||'',unidadBase:c.unidadBase||'g',cantidadBase:0};
      prev.cantidadBase+=req;
      if(c.nombre)prev.nombre=c.nombre;
      out.ingredientes.set(c.refId,prev);
    }
  }
  return out;
}

// ── Calculadora — Modalidad A: por unidades deseadas ────────────
// producto: {porBandeja, porLote} opcionales para bandejas/tandas.
function calcularPorUnidades(version,unidades,resolver,producto){
  const und=Number(unidades);
  if(!(und>0))return{ok:false,error:'La cantidad deseada debe ser mayor que cero'};
  const salida=Number(version.salida&&version.salida.cantidad)||0;
  if(!(salida>0))return{ok:false,error:'La versión no tiene salida esperada definida'};
  const factor=und/salida;
  const req=expandirRequerimientos(version,factor,resolver);
  const pesoUnidad=Number(version.pesoUnidad)||0;
  const res={
    ok:true,factor,unidades:und,
    ingredientes:[...req.ingredientes.values()],
    subrecetas:req.subrecetas,
    errores:req.errores,
    pesoTotalEsperado:pesoUnidad>0?und*pesoUnidad:null,
    bandejas:producto&&Number(producto.porBandeja)>0?Math.ceil(und/Number(producto.porBandeja)):null,
    tandas:producto&&Number(producto.porLote)>0?Math.ceil(und/Number(producto.porLote)):null
  };
  return res;
}

// ── Calculadora — Modalidad B: por ingrediente disponible ───────
// refId: ingrediente limitante; disponibleBase en unidad base de ese ingrediente.
// Calcula cuántas unidades pueden producirse y el resto de requerimientos.
function calcularPorIngrediente(version,refId,disponibleBase,resolver,producto){
  const disp=Number(disponibleBase);
  if(!(disp>0))return{ok:false,error:'La cantidad disponible debe ser mayor que cero'};
  const reqUnLote=expandirRequerimientos(version,1,resolver);
  const ing=reqUnLote.ingredientes.get(refId);
  if(!ing||!(ing.cantidadBase>0))return{ok:false,error:'La receta no utiliza ese ingrediente'};
  const salida=Number(version.salida&&version.salida.cantidad)||0;
  if(!(salida>0))return{ok:false,error:'La versión no tiene salida esperada definida'};
  const factor=disp/ing.cantidadBase;
  const unidadesMax=Math.floor(factor*salida);
  if(!(unidadesMax>0))return{ok:false,error:'La cantidad disponible no alcanza ni para una unidad'};
  const res=calcularPorUnidades(version,unidadesMax,resolver,producto);
  if(res.ok){res.ingredienteLimitante=refId;res.disponibleBase=disp;
    const usado=res.ingredientes.find(i=>i.refId===refId);
    res.sobranteBase=usado?disp-usado.cantidadBase:disp;
  }
  return res;
}

// ── Calculadora — Modalidad C: escalar por factor/porcentaje ────
function escalarPorFactor(version,factor,resolver,producto){
  const f=Number(factor);
  if(!(f>0))return{ok:false,error:'El factor debe ser mayor que cero'};
  const salida=Number(version.salida&&version.salida.cantidad)||0;
  const und=salida*f;
  const req=expandirRequerimientos(version,f,resolver);
  return{ok:true,factor:f,unidades:und,
    ingredientes:[...req.ingredientes.values()],subrecetas:req.subrecetas,errores:req.errores,
    pesoTotalEsperado:Number(version.pesoUnidad)>0&&version.salida.unidad==='und'?und*Number(version.pesoUnidad):null,
    bandejas:producto&&Number(producto.porBandeja)>0&&version.salida.unidad==='und'?Math.ceil(und/Number(producto.porBandeja)):null,
    tandas:producto&&Number(producto.porLote)>0&&version.salida.unidad==='und'?Math.ceil(und/Number(producto.porLote)):null};
}

// ── Fórmulas básicas (documentadas) ─────────────────────────────
// Rendimiento % = unidades buenas reales / unidades esperadas × 100
function rendimientoPct(buenas,esperadas){
  const e=Number(esperadas);if(!(e>0))return null;
  return Number(buenas)/e*100;
}
// Merma % = peso perdido / peso total preparado × 100
function mermaPct(pesoPerdido,pesoPreparado){
  const t=Number(pesoPreparado);if(!(t>0))return null;
  return Math.max(0,Number(pesoPerdido))/t*100;
}
// Peso utilizable = peso total preparado − pérdidas registradas
function pesoUtilizable(pesoPreparado,perdidas){
  return Math.max(0,Number(pesoPreparado)-Math.max(0,Number(perdidas)||0));
}
// Unidades esperadas = peso utilizable / peso estándar por unidad (entero hacia abajo)
function unidadesEsperadas(pesoUtil,pesoUnidad){
  const p=Number(pesoUnidad);if(!(p>0))return null;
  return Math.floor(Number(pesoUtil)/p);
}
// Cumplimiento de peso % = muestras dentro del rango / total muestreado × 100
function cumplimientoPct(dentro,total){
  const t=Number(total);if(!(t>0))return null;
  return Number(dentro)/t*100;
}

// ── Control de peso: estadísticas de muestras ───────────────────
// muestras: [g,...]; tol:{objetivo,min,max}. Sin redondeo interno.
function statsPesos(muestras,tol){
  const xs=(muestras||[]).map(Number).filter(n=>Number.isFinite(n)&&n>0);
  if(!xs.length)return null;
  const suma=xs.reduce((a,b)=>a+b,0);
  const prom=suma/xs.length;
  const min=Math.min(...xs),max=Math.max(...xs);
  const t=tol||{};
  const tMin=Number(t.min),tMax=Number(t.max),obj=Number(t.objetivo);
  const conRango=Number.isFinite(tMin)&&Number.isFinite(tMax)&&tMax>=tMin;
  const dentro=conRango?xs.filter(x=>x>=tMin&&x<=tMax).length:null;
  const varianza=xs.length>1?xs.reduce((a,x)=>a+(x-prom)*(x-prom),0)/(xs.length-1):0;
  return{
    n:xs.length,promedio:prom,min,max,
    desvEstandar:Math.sqrt(varianza),
    desvObjetivo:Number.isFinite(obj)?prom-obj:null,
    dentro,fuera:conRango?xs.length-dentro:null,
    cumplimientoPct:conRango?cumplimientoPct(dentro,xs.length):null
  };
}
// "118, 122 130" → [118,122,130]
function parseMuestras(texto){
  return String(texto||'').split(/[\s,;]+/).map(s=>Number(String(s).replace(',','.'))).filter(n=>Number.isFinite(n)&&n>0);
}

// ── Validación del registro real de producción ──────────────────
// real:{producidas,buenas,defectuosas,quemadas,rotas,deformadas,muestra,
//       reprocesadas,pesoObtenido,pesoSobrante,horaInicio,horaFin}
// Devuelve {errores:[], avisos:[]}. No se permiten negativos ni
// inconsistencias matemáticas evidentes.
function validarRegistroReal(real){
  const errores=[],avisos=[];
  if(!real)return{errores:['Registro vacío'],avisos};
  const campos=['producidas','buenas','defectuosas','quemadas','rotas','deformadas','muestra','reprocesadas','pesoObtenido','pesoSobrante'];
  for(const k of campos){
    const n=Number(real[k]??0);
    if(!Number.isFinite(n)||n<0)errores.push(`"${k}" no puede ser negativo ni inválido`);
  }
  const prod=Number(real.producidas)||0;
  const clasificadas=['buenas','defectuosas','quemadas','rotas','deformadas','muestra'].reduce((s,k)=>s+(Number(real[k])||0),0);
  if(!(prod>0))errores.push('Las unidades producidas deben ser mayores que cero');
  if(clasificadas>prod)errores.push(`La suma de unidades clasificadas (${clasificadas}) supera las producidas (${prod})`);
  else if(prod>0&&clasificadas<prod)avisos.push(`Hay ${prod-clasificadas} unidad(es) producida(s) sin clasificar`);
  if((Number(real.reprocesadas)||0)>prod)errores.push('Las unidades reprocesadas no pueden superar las producidas');
  if(real.horaInicio&&real.horaFin&&duracionMin(real.horaInicio,real.horaFin)===0)avisos.push('La duración registrada es cero');
  return{errores,avisos};
}
// Duración en minutos entre "HH:MM"; si fin < inicio se asume cruce de medianoche.
function duracionMin(inicio,fin){
  const p=t=>{const[m,h]=[String(t).slice(3,5),String(t).slice(0,2)];const H=Number(h),M=Number(m);return Number.isFinite(H)&&Number.isFinite(M)?H*60+M:null};
  const a=p(inicio),b=p(fin);
  if(a==null||b==null)return null;
  return b>=a?b-a:b+1440-a;
}

// ── KPIs plan vs real de una orden ──────────────────────────────
// plan:{unidades,pesoTotalEsperado,tiempoEsperadoMin}, real: registro real.
function calcularKpis(plan,real){
  const buenas=Number(real.buenas)||0;
  const pesoTeorico=Number(plan.pesoTotalEsperado)||null;
  const pesoObt=Number(real.pesoObtenido)||0;
  const sobrante=Number(real.pesoSobrante)||0;
  const perdido=pesoTeorico!=null?Math.max(0,pesoTeorico-pesoObt-sobrante):null;
  const dur=real.horaInicio&&real.horaFin?duracionMin(real.horaInicio,real.horaFin):null;
  return{
    unidadesPlan:Number(plan.unidades)||0,
    unidadesReal:Number(real.producidas)||0,
    buenas,
    rendimientoPct:rendimientoPct(buenas,plan.unidades),
    pesoTeorico,pesoObtenido:pesoObt,pesoSobrante:sobrante,pesoPerdido:perdido,
    mermaPct:pesoTeorico!=null?mermaPct(perdido,pesoTeorico):null,
    duracionMin:dur,
    tiempoEsperadoMin:Number(plan.tiempoEsperadoMin)||null,
    desviacionUnidades:(Number(real.producidas)||0)-(Number(plan.unidades)||0)
  };
}

// ── Snapshot inmutable de receta para órdenes históricas ────────
// Al crear una orden se congela una copia completa de la versión.
// Cambios futuros de la receta NO alteran órdenes ni lotes históricos.
function snapshotVersion(version,receta,producto){
  const copia=JSON.parse(JSON.stringify({version,receta:receta?{id:receta.id,nombre:receta.nombre,tipo:receta.tipo}:null,producto:producto?{id:producto.id,codigo:producto.codigo,nombre:producto.nombre}:null,tomadoEn:new Date().toISOString()}));
  return copia;
}

// ── Roles y permisos ────────────────────────────────────────────
// Matriz de capacidades por rol. Se aplica en la capa de datos
// (estGuard en la UI), no solo ocultando botones.
// Roles actuales del sistema: 'admin' y 'viewer'. Los roles
// 'tecnico', 'maestro' y 'calidad' quedan definidos para cuando se
// agreguen credenciales propias.
const PERMISOS={
  admin:  ['ver','ing.crud','prod.crud','receta.crear','receta.editar','receta.aprobar','orden.crear','orden.estado','orden.real','calidad.evaluar','lote.resolver','config','auditoria.ver','demo.cargar','exportar'],
  tecnico:['ver','ing.crud','prod.crud','receta.crear','receta.editar','receta.aprobar','orden.crear','orden.estado','calidad.evaluar','auditoria.ver','exportar'],
  maestro:['ver','orden.crear','orden.estado','orden.real','exportar'],
  calidad:['ver','calidad.evaluar','lote.resolver','auditoria.ver'],
  viewer: ['ver']
};
function puede(rol,accion){return(PERMISOS[rol]||[]).includes(accion)}

// ── Generación de códigos ───────────────────────────────────────
function genCodigo(prefijo,seq,fechaISO){
  const f=(fechaISO||'').replace(/-/g,'');
  return f?`${prefijo}-${f}-${String(seq).padStart(3,'0')}`:`${prefijo}-${String(seq).padStart(3,'0')}`;
}

// ── Evaluación sensorial ────────────────────────────────────────
// Atributos por defecto (configurables desde la UI si se desea).
const ATRIBUTOS_SENSORIALES=['Apariencia','Color','Aroma','Sabor','Dulzor','Salinidad',
  'Textura exterior','Textura interior','Humedad','Suavidad','Elasticidad','Uniformidad','Aceptación general'];
// evaluaciones: [{evaluador,tipo,fecha,valores:{Atributo:n},comentario}]
// Devuelve promedio/dispersión por atributo y una puntuación general
// (usa "Aceptación general" si existe; si no, el promedio de atributos).
function resumenSensorial(evaluaciones,atributos){
  const evals=evaluaciones||[];
  const atrs=(atributos&&atributos.length)?atributos:ATRIBUTOS_SENSORIALES;
  const porAtributo=atrs.map(nombre=>{
    const xs=evals.map(e=>Number(e.valores&&e.valores[nombre])).filter(n=>Number.isFinite(n)&&n>0);
    if(!xs.length)return{nombre,n:0,promedio:null,min:null,max:null,desv:null};
    const prom=xs.reduce((a,b)=>a+b,0)/xs.length;
    const vari=xs.length>1?xs.reduce((a,x)=>a+(x-prom)*(x-prom),0)/(xs.length-1):0;
    return{nombre,n:xs.length,promedio:prom,min:Math.min(...xs),max:Math.max(...xs),desv:Math.sqrt(vari)};
  });
  const acc=porAtributo.find(a=>a.nombre==='Aceptación general'&&a.n>0);
  let general;
  if(acc)general={promedio:acc.promedio,n:acc.n,fuente:'aceptación general'};
  else{
    const conDatos=porAtributo.filter(a=>a.promedio!=null);
    general=conDatos.length
      ?{promedio:conDatos.reduce((s,a)=>s+a.promedio,0)/conDatos.length,n:evals.length,fuente:'promedio de atributos'}
      :{promedio:null,n:0,fuente:null};
  }
  return{porAtributo,general,nEvaluaciones:evals.length};
}

// ── Lote dorado: comparación de un lote contra el ideal ─────────
// Recibe dos "perfiles" de lote (objetos con métricas ya calculadas)
// y devuelve, por indicador, la diferencia absoluta y porcentual.
function compararLoteDorado(actual,dorado){
  const a=actual||{},d=dorado||{};
  const campos=[
    {clave:'pesoProm',label:'Peso promedio (g)'},
    {clave:'rendimiento',label:'Rendimiento %'},
    {clave:'merma',label:'Merma %'},
    {clave:'duracion',label:'Tiempo (min)'},
    {clave:'sensorial',label:'Puntuación sensorial'}
  ];
  return campos.map(c=>{
    const va=a[c.clave],vd=d[c.clave];
    const dif=(Number.isFinite(Number(va))&&Number.isFinite(Number(vd)))?Number(va)-Number(vd):null;
    return{clave:c.clave,label:c.label,
      actual:(va==null||va==='')?null:Number(va),
      dorado:(vd==null||vd==='')?null:Number(vd),
      dif,difPct:(dif!=null&&Number(vd))?dif/Number(vd)*100:null};
  });
}

// ── Comparación de dos versiones de receta ──────────────────────
// Compara componentes (por tipo+refId) y las métricas de la versión.
// Cada componente puede quedar: 'agregado' (solo en B), 'quitado'
// (solo en A), 'cambiado' (distinta cantidad base) o 'igual'.
// Los componentes deben traer `nombre` para mostrarse (la UI lo enriquece).
function compararVersiones(vA,vB){
  const A=vA||{},B=vB||{};
  const pctA=calcularPorcentajes((A.componentes||[]).map(c=>({...c,cantidad:c.cantidadBase})));
  const pctB=calcularPorcentajes((B.componentes||[]).map(c=>({...c,cantidad:c.cantidadBase})));
  const clave=c=>`${c.tipo==='sub'?'sub':'ing'}:${c.refId}`;
  const mapA=new Map(pctA.map(c=>[clave(c),c]));
  const mapB=new Map(pctB.map(c=>[clave(c),c]));
  const claves=[...new Set([...mapA.keys(),...mapB.keys()])];
  const componentes=claves.map(k=>{
    const a=mapA.get(k),b=mapB.get(k),ref=a||b;
    let estado;
    if(a&&!b)estado='quitado';
    else if(!a&&b)estado='agregado';
    else if(Math.abs((Number(a.cantidadBase)||0)-(Number(b.cantidadBase)||0))>1e-6)estado='cambiado';
    else estado='igual';
    return{clave:k,tipo:ref.tipo==='sub'?'sub':'ing',refId:ref.refId,
      nombre:(a&&a.nombre)||(b&&b.nombre)||k,
      cantidadA:a?Number(a.cantidadBase)||0:null,cantidadB:b?Number(b.cantidadBase)||0:null,
      pctA:a?a.porcentaje:null,pctB:b?b.porcentaje:null,estado};
  });
  const campo=(x,y)=>({a:x??null,b:y??null,cambio:(Number(x)||0)!==(Number(y)||0)});
  const tPasos=v=>(v.pasos||[]).reduce((s,p)=>s+(Number(p.tiempoMin)||0),0);
  return{
    componentes,
    salida:campo(A.salida&&A.salida.cantidad,B.salida&&B.salida.cantidad),
    unidadSalida:{a:A.salida&&A.salida.unidad||null,b:B.salida&&B.salida.unidad||null},
    pesoUnidad:campo(A.pesoUnidad,B.pesoUnidad),
    tiempoEsperadoMin:campo(A.tiempoEsperadoMin,B.tiempoEsperadoMin),
    nPasos:campo((A.pasos||[]).length,(B.pasos||[]).length),
    tiempoPasosMin:campo(tPasos(A),tPasos(B)),
    hayCambios:componentes.some(c=>c.estado!=='igual')
  };
}

return{
  UNIDADES_BASE,CONV_ESTANDAR,
  ESTADOS_VERSION,ESTADOS_ORDEN,ESTADOS_LOTE,ESTADOS_PRODUCTO,
  aBase,deBase,redondear,fmtCantidad,normUnidad,
  calcularPorcentajes,
  puedeEditarVersion,transicionVersionValida,transicionOrdenValida,
  validarVersion,creaCiclo,expandirRequerimientos,
  calcularPorUnidades,calcularPorIngrediente,escalarPorFactor,
  rendimientoPct,mermaPct,pesoUtilizable,unidadesEsperadas,cumplimientoPct,
  statsPesos,parseMuestras,
  validarRegistroReal,duracionMin,calcularKpis,
  snapshotVersion,
  PERMISOS,puede,genCodigo,
  compararVersiones,
  ATRIBUTOS_SENSORIALES,resumenSensorial,
  compararLoteDorado
};
});
