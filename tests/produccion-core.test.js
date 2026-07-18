// ════════════════════════════════════════════════════════════════
// Pruebas del núcleo de Producción y Estandarización.
// Ejecutar con:  node tests/produccion-core.test.js
// No requiere dependencias externas.
// ════════════════════════════════════════════════════════════════
'use strict';
const assert=require('assert');
const C=require('../public/produccion-core.js');

let pasadas=0,falladas=0;
function test(nombre,fn){
  try{fn();pasadas++;console.log('  ✓ '+nombre);}
  catch(e){falladas++;console.error('  ✗ '+nombre+'\n    '+e.message);}
}
function casi(a,b,eps=1e-9){assert.ok(Math.abs(a-b)<eps,`esperado ${b}, obtenido ${a}`)}

// ── Datos de prueba (ficticios) ─────────────────────────────────
// Subreceta: masa base — salida 10000 g por lote
const versionMasa={
  salida:{cantidad:10000,unidad:'g'},
  componentes:[
    {tipo:'ing',refId:1,nombre:'Harina',unidadBase:'g',cantidad:5600,esBase:true,orden:1},
    {tipo:'ing',refId:2,nombre:'Agua',unidadBase:'ml',cantidad:3080,orden:2},
    {tipo:'ing',refId:3,nombre:'Azúcar',unidadBase:'g',cantidad:560,orden:3},
    {tipo:'ing',refId:4,nombre:'Sal',unidadBase:'g',cantidad:112,orden:4},
    {tipo:'ing',refId:5,nombre:'Levadura',unidadBase:'g',cantidad:84,orden:5}
  ],pasos:[]
};
// Subreceta: relleno — salida 5000 g por lote
const versionRelleno={
  salida:{cantidad:5000,unidad:'g'},
  componentes:[{tipo:'ing',refId:6,nombre:'Queso',unidadBase:'g',cantidad:5000,esBase:true,orden:1}],
  pasos:[]
};
// Producto final: empanada — 100 und por lote; 70 g masa + 45 g relleno + bolsa + etiqueta
const versionEmpanada={
  salida:{cantidad:100,unidad:'und'},pesoUnidad:115,
  componentes:[
    {tipo:'sub',refId:101,nombre:'Masa base',cantidad:7000,orden:1},
    {tipo:'sub',refId:102,nombre:'Relleno de queso',cantidad:4500,orden:2},
    {tipo:'ing',refId:7,nombre:'Bolsa',unidadBase:'und',cantidad:100,orden:3},
    {tipo:'ing',refId:8,nombre:'Etiqueta',unidadBase:'und',cantidad:100,orden:4}
  ],pasos:[]
};
const RECETAS={101:{receta:{id:101,nombre:'Masa base',tipo:'sub'},version:versionMasa},
               102:{receta:{id:102,nombre:'Relleno de queso',tipo:'sub'},version:versionRelleno}};
const resolver=id=>RECETAS[id]||null;

console.log('\n■ Conversión de unidades');
test('gramos a base',()=>{casi(C.aBase(500,'g','g').cantidadBase,500)});
test('kilogramos a gramos',()=>{casi(C.aBase(2.5,'kg','g').cantidadBase,2500)});
test('litros a mililitros',()=>{casi(C.aBase(1.5,'L','ml').cantidadBase,1500)});
test('docena a unidades',()=>{casi(C.aBase(2,'docena','und').cantidadBase,24)});
test('base a kilogramos',()=>{casi(C.deBase(2500,'kg','g').cantidad,2.5)});
test('unidad incompatible es rechazada',()=>{assert.strictEqual(C.aBase(1,'kg','ml').ok,false)});
test('cantidad negativa es rechazada',()=>{assert.strictEqual(C.aBase(-5,'g','g').ok,false)});
test('presentación configurable: saco de 40 kg',()=>{
  const pres=[{nombre:'Saco 40kg',factorBase:40000}];
  casi(C.aBase(2,'Saco 40kg','g',pres).cantidadBase,80000);
});
test('presentación configurable distinta: saco de 50 kg',()=>{
  const pres=[{nombre:'Saco 50kg',factorBase:50000}];
  casi(C.aBase(1,'saco 50kg','g',pres).cantidadBase,50000);
});
test('presentación desconocida es rechazada',()=>{assert.strictEqual(C.aBase(1,'saco','g',[]).ok,false)});

console.log('\n■ Porcentaje panadero');
test('porcentajes respecto al componente base',()=>{
  const r=C.calcularPorcentajes(versionMasa.componentes);
  casi(r[0].porcentaje,100);
  casi(r[1].porcentaje,55);
  casi(r[2].porcentaje,10);
  casi(r[3].porcentaje,2);
  casi(r[4].porcentaje,1.5);
});
test('sin componente base no hay porcentajes',()=>{
  const r=C.calcularPorcentajes([{cantidad:100},{cantidad:50}]);
  assert.strictEqual(r[0].porcentaje,null);
});
test('la base no tiene que ser harina',()=>{
  const r=C.calcularPorcentajes([{nombre:'Queso',cantidad:2000,esBase:true},{nombre:'Crema',cantidad:500}]);
  casi(r[1].porcentaje,25);
});

console.log('\n■ Validación y creación de versiones de receta');
test('versión válida pasa la validación',()=>{assert.deepStrictEqual(C.validarVersion(versionMasa),[])});
test('versión sin componentes es inválida',()=>{assert.ok(C.validarVersion({salida:{cantidad:10,unidad:'und'},componentes:[]}).length>0)});
test('cantidad cero es inválida',()=>{
  assert.ok(C.validarVersion({salida:{cantidad:10,unidad:'und'},componentes:[{refId:1,cantidad:0}]}).length>0);
});
test('dos componentes base son inválidos',()=>{
  assert.ok(C.validarVersion({salida:{cantidad:10,unidad:'und'},componentes:[{refId:1,cantidad:1,esBase:true},{refId:2,cantidad:1,esBase:true}]}).length>0);
});

console.log('\n■ Protección de recetas aprobadas');
test('borrador y en prueba son editables',()=>{
  assert.ok(C.puedeEditarVersion('borrador'));
  assert.ok(C.puedeEditarVersion('en_prueba'));
});
test('una versión aprobada NO es editable',()=>{assert.strictEqual(C.puedeEditarVersion('aprobada'),false)});
test('reemplazada y archivada NO son editables',()=>{
  assert.strictEqual(C.puedeEditarVersion('reemplazada'),false);
  assert.strictEqual(C.puedeEditarVersion('archivada'),false);
});
test('transición aprobada→reemplazada es válida',()=>{assert.ok(C.transicionVersionValida('aprobada','reemplazada'))});
test('transición aprobada→borrador es inválida',()=>{assert.strictEqual(C.transicionVersionValida('aprobada','borrador'),false)});

console.log('\n■ Subrecetas y prevención de ciclos');
test('componentes sin subrecetas no crean ciclo',()=>{
  assert.strictEqual(C.creaCiclo(101,versionMasa.componentes,()=>[]),false);
});
test('autoreferencia directa crea ciclo',()=>{
  assert.strictEqual(C.creaCiclo(101,[{tipo:'sub',refId:101}],()=>[]),true);
});
test('ciclo indirecto A→B→A es detectado',()=>{
  const res=id=>id===102?[{tipo:'sub',refId:101}]:[];
  assert.strictEqual(C.creaCiclo(101,[{tipo:'sub',refId:102}],res),true);
});
test('cadena A→B→C sin ciclo es aceptada',()=>{
  const res=id=>id===102?[{tipo:'sub',refId:103}]:[];
  assert.strictEqual(C.creaCiclo(101,[{tipo:'sub',refId:102}],res),false);
});

console.log('\n■ Calculadora — Modalidad A (por unidades)');
test('200 empanadas escalan subrecetas e ingredientes',()=>{
  const r=C.calcularPorUnidades(versionEmpanada,200,resolver,{porBandeja:20,porLote:100});
  assert.ok(r.ok);
  casi(r.factor,2);
  const masa=r.subrecetas.find(s=>s.refId===101);
  casi(masa.cantidadBase,14000);          // 200 × 70 g
  const harina=r.ingredientes.find(i=>i.refId===1);
  casi(harina.cantidadBase,7840);         // 5600 × (14000/10000)
  const queso=r.ingredientes.find(i=>i.refId===6);
  casi(queso.cantidadBase,9000);          // 200 × 45 g
  const bolsas=r.ingredientes.find(i=>i.refId===7);
  casi(bolsas.cantidadBase,200);
  casi(r.pesoTotalEsperado,23000);        // 200 × 115 g
  assert.strictEqual(r.bandejas,10);
  assert.strictEqual(r.tandas,2);
});
test('cantidad cero es rechazada',()=>{assert.strictEqual(C.calcularPorUnidades(versionEmpanada,0,resolver).ok,false)});
test('merma estimada del componente aumenta el requerimiento',()=>{
  const v={salida:{cantidad:10,unidad:'und'},componentes:[{tipo:'ing',refId:1,unidadBase:'g',cantidad:1000,mermaPct:10}]};
  const r=C.calcularPorUnidades(v,10,null);
  casi(r.ingredientes[0].cantidadBase,1100);
});

console.log('\n■ Calculadora — Modalidad B (por ingrediente disponible)');
test('con 15 kg de harina se calculan unidades máximas',()=>{
  // Por lote de 100 empanadas se usan 3920 g de harina (5600×0.7)
  const r=C.calcularPorIngrediente(versionEmpanada,1,15000,resolver);
  assert.ok(r.ok);
  assert.strictEqual(r.unidades,Math.floor(15000/3920*100)); // 382
  const harina=r.ingredientes.find(i=>i.refId===1);
  assert.ok(harina.cantidadBase<=15000);
  assert.ok(r.sobranteBase>=0);
});
test('ingrediente que no está en la receta es rechazado',()=>{
  assert.strictEqual(C.calcularPorIngrediente(versionEmpanada,999,5000,resolver).ok,false);
});
test('cantidad insuficiente para una unidad es rechazada',()=>{
  assert.strictEqual(C.calcularPorIngrediente(versionEmpanada,1,10,resolver).ok,false);
});

console.log('\n■ Calculadora — Modalidad C (escalar por factor)');
test('factor 0.5 reduce la receta a la mitad',()=>{
  const r=C.escalarPorFactor(versionMasa,0.5,null);
  assert.ok(r.ok);
  casi(r.ingredientes.find(i=>i.refId===1).cantidadBase,2800);
  casi(r.unidades,5000); // 5000 g de salida
});
test('factor inválido es rechazado',()=>{assert.strictEqual(C.escalarPorFactor(versionMasa,0,null).ok,false)});

console.log('\n■ Fórmulas básicas');
test('rendimiento: 190 buenas de 200 esperadas = 95%',()=>{casi(C.rendimientoPct(190,200),95)});
test('merma: 500 g perdidos de 23000 g preparados',()=>{casi(C.mermaPct(500,23000),500/23000*100)});
test('peso utilizable = preparado − pérdidas',()=>{casi(C.pesoUtilizable(23000,500),22500)});
test('unidades esperadas = utilizable / peso estándar (entero)',()=>{
  assert.strictEqual(C.unidadesEsperadas(22500,115),195);
});
test('cumplimiento: 2 de 3 muestras en rango',()=>{casi(C.cumplimientoPct(2,3),200/3)});
test('rendimiento con esperadas cero devuelve null',()=>{assert.strictEqual(C.rendimientoPct(10,0),null)});

console.log('\n■ Control de peso (tolerancias y muestras)');
test('estadísticas de muestras 118/122/130 con rango 110–125',()=>{
  const s=C.statsPesos([118,122,130],{objetivo:115,min:110,max:125});
  casi(s.promedio,(118+122+130)/3);
  assert.strictEqual(s.min,118);
  assert.strictEqual(s.max,130);
  assert.strictEqual(s.dentro,2);
  assert.strictEqual(s.fuera,1);
  casi(s.cumplimientoPct,200/3);
  casi(s.desvObjetivo,(118+122+130)/3-115);
});
test('parseo de muestras desde texto libre',()=>{
  assert.deepStrictEqual(C.parseMuestras('118, 122 130; 125'),[118,122,130,125]);
});
test('muestras vacías devuelven null',()=>{assert.strictEqual(C.statsPesos([],{}),null)});

console.log('\n■ Registro real: validaciones');
test('registro coherente es aceptado',()=>{
  const r=C.validarRegistroReal({producidas:200,buenas:190,defectuosas:5,quemadas:3,muestra:2,pesoObtenido:22000,pesoSobrante:300});
  assert.deepStrictEqual(r.errores,[]);
});
test('cantidades negativas son rechazadas',()=>{
  const r=C.validarRegistroReal({producidas:100,buenas:-5});
  assert.ok(r.errores.length>0);
});
test('clasificadas > producidas es rechazado',()=>{
  const r=C.validarRegistroReal({producidas:100,buenas:90,defectuosas:20});
  assert.ok(r.errores.some(e=>e.includes('supera')));
});
test('unidades sin clasificar generan aviso, no error',()=>{
  const r=C.validarRegistroReal({producidas:100,buenas:90});
  assert.deepStrictEqual(r.errores,[]);
  assert.ok(r.avisos.length>0);
});
test('duración con cruce de medianoche',()=>{
  assert.strictEqual(C.duracionMin('23:30','01:00'),90);
  assert.strictEqual(C.duracionMin('08:00','10:15'),135);
});

console.log('\n■ KPIs plan vs real');
test('kpis de la orden de ejemplo (200 plan / 190 buenas)',()=>{
  const k=C.calcularKpis(
    {unidades:200,pesoTotalEsperado:23000,tiempoEsperadoMin:120},
    {producidas:200,buenas:190,pesoObtenido:22000,pesoSobrante:300,horaInicio:'06:00',horaFin:'08:30'}
  );
  casi(k.rendimientoPct,95);
  casi(k.pesoPerdido,700);
  casi(k.mermaPct,700/23000*100);
  assert.strictEqual(k.duracionMin,150);
  assert.strictEqual(k.desviacionUnidades,0);
});

console.log('\n■ Snapshot histórico de recetas');
test('el snapshot es una copia profunda e independiente',()=>{
  const snap=C.snapshotVersion(versionEmpanada,{id:1,nombre:'Empanada de queso',tipo:'producto'},{id:1,codigo:'PRD-001',nombre:'Empanada de queso'});
  const cantidadOriginal=snap.version.componentes[0].cantidad;
  versionEmpanada.componentes[0].cantidad=99999; // modificación posterior de la receta
  assert.strictEqual(snap.version.componentes[0].cantidad,cantidadOriginal);
  versionEmpanada.componentes[0].cantidad=7000;  // restaurar
});

console.log('\n■ Roles y permisos');
test('admin puede aprobar recetas',()=>{assert.ok(C.puede('admin','receta.aprobar'))});
test('viewer solo puede ver',()=>{
  assert.ok(C.puede('viewer','ver'));
  assert.strictEqual(C.puede('viewer','receta.editar'),false);
  assert.strictEqual(C.puede('viewer','orden.real'),false);
  assert.strictEqual(C.puede('viewer','demo.cargar'),false);
});
test('maestro no puede aprobar recetas',()=>{assert.strictEqual(C.puede('maestro','receta.aprobar'),false)});
test('calidad puede resolver lotes pero no crear recetas',()=>{
  assert.ok(C.puede('calidad','lote.resolver'));
  assert.strictEqual(C.puede('calidad','receta.crear'),false);
});
test('rol desconocido no tiene permisos (acceso no autorizado)',()=>{
  assert.strictEqual(C.puede('hacker','ver'),false);
  assert.strictEqual(C.puede(null,'receta.aprobar'),false);
});

console.log('\n■ Redondeo y formato');
test('no se redondea internamente, solo al formatear',()=>{
  const r=C.calcularPorUnidades({salida:{cantidad:3,unidad:'und'},componentes:[{tipo:'ing',refId:1,unidadBase:'g',cantidad:100}]},1,null);
  casi(r.ingredientes[0].cantidadBase,100/3);
});
test('formato práctico g→kg',()=>{
  assert.strictEqual(C.fmtCantidad(1520,'g'),'1.52 kg');
  assert.strictEqual(C.fmtCantidad(300,'g'),'300 g');
  assert.strictEqual(C.fmtCantidad(2500,'ml'),'2.5 L');
});
test('genCodigo produce códigos legibles',()=>{
  assert.strictEqual(C.genCodigo('OP',7,'2026-07-14'),'OP-20260714-007');
});

console.log('\n■ Comparación de versiones');
test('detecta ingredientes agregados, quitados y cambiados',()=>{
  const vA={salida:{cantidad:10,unidad:'und'},pesoUnidad:80,tiempoEsperadoMin:60,
    componentes:[
      {tipo:'ing',refId:1,nombre:'Harina',cantidadBase:1000,esBase:true},
      {tipo:'ing',refId:2,nombre:'Agua',cantidadBase:600},
      {tipo:'ing',refId:3,nombre:'Sal',cantidadBase:20}
    ],pasos:[{tiempoMin:20},{tiempoMin:40}]};
  const vB={salida:{cantidad:12,unidad:'und'},pesoUnidad:75,tiempoEsperadoMin:55,
    componentes:[
      {tipo:'ing',refId:1,nombre:'Harina',cantidadBase:1000,esBase:true},
      {tipo:'ing',refId:2,nombre:'Agua',cantidadBase:650},   // cambiado
      {tipo:'ing',refId:4,nombre:'Aceite',cantidadBase:30}    // agregado (sal quitada)
    ],pasos:[{tiempoMin:25},{tiempoMin:40}]};
  const d=C.compararVersiones(vA,vB);
  const byNombre=n=>d.componentes.find(c=>c.nombre===n);
  assert.strictEqual(byNombre('Sal').estado,'quitado');
  assert.strictEqual(byNombre('Aceite').estado,'agregado');
  assert.strictEqual(byNombre('Agua').estado,'cambiado');
  assert.strictEqual(byNombre('Harina').estado,'igual');
  assert.ok(d.hayCambios);
});
test('compara métricas de la versión (salida, peso, tiempos)',()=>{
  const vA={salida:{cantidad:10,unidad:'und'},pesoUnidad:80,componentes:[{tipo:'ing',refId:1,cantidadBase:100,esBase:true}],pasos:[{tiempoMin:20}]};
  const vB={salida:{cantidad:10,unidad:'und'},pesoUnidad:90,componentes:[{tipo:'ing',refId:1,cantidadBase:100,esBase:true}],pasos:[{tiempoMin:20}]};
  const d=C.compararVersiones(vA,vB);
  assert.strictEqual(d.salida.cambio,false);
  assert.strictEqual(d.pesoUnidad.cambio,true);
  assert.strictEqual(d.pesoUnidad.a,80);
  assert.strictEqual(d.pesoUnidad.b,90);
  assert.strictEqual(d.hayCambios,false); // ingredientes iguales
});
test('el porcentaje panadero se recalcula por versión',()=>{
  const v={salida:{cantidad:10,unidad:'und'},componentes:[
    {tipo:'ing',refId:1,nombre:'Harina',cantidadBase:1000,esBase:true},
    {tipo:'ing',refId:2,nombre:'Agua',cantidadBase:600}]};
  const d=C.compararVersiones(v,v);
  const agua=d.componentes.find(c=>c.nombre==='Agua');
  assert.strictEqual(agua.estado,'igual');
  casi(agua.pctA,60);
  casi(agua.pctB,60);
});

console.log('\n■ Evaluación sensorial');
test('promedia por atributo y usa Aceptación general como puntuación',()=>{
  const evals=[
    {evaluador:'Mari',valores:{'Sabor':5,'Aceptación general':5}},
    {evaluador:'Juan',valores:{'Sabor':3,'Aceptación general':4}}
  ];
  const r=C.resumenSensorial(evals);
  const sabor=r.porAtributo.find(a=>a.nombre==='Sabor');
  casi(sabor.promedio,4); assert.strictEqual(sabor.n,2);
  assert.strictEqual(sabor.min,3); assert.strictEqual(sabor.max,5);
  casi(r.general.promedio,4.5);
  assert.strictEqual(r.general.fuente,'aceptación general');
  assert.strictEqual(r.nEvaluaciones,2);
});
test('sin Aceptación general usa el promedio de atributos',()=>{
  const evals=[{evaluador:'Mari',valores:{'Color':4,'Aroma':2}}];
  const r=C.resumenSensorial(evals);
  casi(r.general.promedio,3);
  assert.strictEqual(r.general.fuente,'promedio de atributos');
});
test('ignora valores vacíos o inválidos y maneja lista vacía',()=>{
  const r=C.resumenSensorial([{valores:{'Sabor':0,'Color':'x'}}]);
  assert.strictEqual(r.porAtributo.find(a=>a.nombre==='Sabor').n,0);
  assert.strictEqual(r.general.promedio,null);
  const vacio=C.resumenSensorial([]);
  assert.strictEqual(vacio.nEvaluaciones,0);
});

console.log('\n■ Lote dorado');
test('compara métricas de un lote contra el dorado (dif absoluta y %)',()=>{
  const actual={pesoProm:82,rendimiento:90,merma:16,duracion:70,sensorial:4.2};
  const dorado={pesoProm:80,rendimiento:95,merma:14,duracion:60,sensorial:4.6};
  const r=C.compararLoteDorado(actual,dorado);
  const peso=r.find(x=>x.clave==='pesoProm');
  assert.strictEqual(peso.dif,2); casi(peso.difPct,2.5);
  const rend=r.find(x=>x.clave==='rendimiento');
  assert.strictEqual(rend.dif,-5);
});
test('maneja indicadores faltantes sin romper',()=>{
  const r=C.compararLoteDorado({pesoProm:80},{});
  const peso=r.find(x=>x.clave==='pesoProm');
  assert.strictEqual(peso.actual,80); assert.strictEqual(peso.dorado,null);
  assert.strictEqual(peso.dif,null); assert.strictEqual(peso.difPct,null);
});

console.log('\n■ Propiedad por organización');
test('un registro pertenece a su organización',()=>{
  assert.strictEqual(C.perteneceAOrg({organizacion:2},2,1),true);
  assert.strictEqual(C.perteneceAOrg({organizacion:2},1,1),false);
});
test('registros sin organización caen en la organización por defecto',()=>{
  assert.strictEqual(C.perteneceAOrg({},1,1),true);
  assert.strictEqual(C.perteneceAOrg({organizacion:null},1,1),true);
  assert.strictEqual(C.perteneceAOrg({},2,1),false);
});

console.log('\n■ Confidencialidad y control de exportación');
test('nivel por defecto es interna cuando falta o es desconocido',()=>{
  assert.strictEqual(C.nivelConfidencial(null),'interna');
  assert.strictEqual(C.nivelConfidencial({}),'interna');
  assert.strictEqual(C.nivelConfidencial({confidencialidad:'X'}),'interna');
  assert.strictEqual(C.normNivelConfidencial('  PLANTILLA '),'plantilla');
});
test('restringida: no se exporta ni se transfiere',()=>{
  assert.strictEqual(C.puedeExportarReceta('restringida'),false);
  assert.strictEqual(C.puedeTransferirReceta('restringida'),false);
  assert.strictEqual(C.requiereAutorizacionExport('restringida'),false);
});
test('interna: exporta con autorización, no se transfiere',()=>{
  assert.strictEqual(C.puedeExportarReceta('interna'),true);
  assert.strictEqual(C.requiereAutorizacionExport('interna'),true);
  assert.strictEqual(C.puedeTransferirReceta('interna'),false);
});
test('plantilla y transferible: exportan sin autorización y se transfieren',()=>{
  ['plantilla','transferible'].forEach(n=>{
    assert.strictEqual(C.puedeExportarReceta(n),true,n);
    assert.strictEqual(C.requiereAutorizacionExport(n),false,n);
    assert.strictEqual(C.puedeTransferirReceta(n),true,n);
  });
});
test('política devuelve el nivel normalizado y las tres acciones',()=>{
  const p=C.politicaConfidencial('desconocido');
  assert.strictEqual(p.nivel,'interna');
  assert.strictEqual(p.exportar,'autorizar');
  assert.strictEqual(p.transferir,'bloqueado');
});

console.log(`\n══════════════════════════════════`);
console.log(`Resultado: ${pasadas} pasadas, ${falladas} falladas`);
if(falladas>0)process.exit(1);
