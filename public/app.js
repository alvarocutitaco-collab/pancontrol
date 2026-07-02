// ════════════════════════════════════════════
// ROLES Y LOGIN (el servidor valida la contraseña y guarda la sesión)
// ════════════════════════════════════════════
let currentRole=null;

// Elimina fondo blanco del video en canvas frame a frame (BFS desde bordes)
let _introRaf=null;
function _startIntroCanvas(video){
  const canvas=document.getElementById('intro-canvas');
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  function setup(){
    canvas.width=video.videoWidth||720;
    canvas.height=video.videoHeight||1280;
    function frame(){
      if(video.paused||video.ended)return;
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const W=canvas.width,H=canvas.height;
      const img=ctx.getImageData(0,0,W,H);
      const d=img.data;
      const vis=new Uint8Array(W*H);
      const stk=new Int32Array(W*H);
      let top=0;
      const T=235;
      function push(i){
        const di=i<<2;
        if(!vis[i]&&d[di]>=T&&d[di+1]>=T&&d[di+2]>=T){vis[i]=1;stk[top++]=i;}
      }
      for(let x=0;x<W;x++){push(x);push((H-1)*W+x);}
      for(let y=1;y<H-1;y++){push(y*W);push(y*W+W-1);}
      while(top>0){
        const i=stk[--top];
        const di=i<<2;
        d[di+3]=0;
        const x=i%W,y=(i/W)|0;
        if(x>0)push(i-1);
        if(x<W-1)push(i+1);
        if(y>0)push(i-W);
        if(y<H-1)push(i+W);
      }
      ctx.putImageData(img,0,0);
      _introRaf=requestAnimationFrame(frame);
    }
    _introRaf=requestAnimationFrame(frame);
  }
  if(video.readyState>=1)setup();
  else video.addEventListener('loadedmetadata',setup,{once:true});
}
function _stopIntroCanvas(){
  if(_introRaf){cancelAnimationFrame(_introRaf);_introRaf=null;}
}

async function doLogin(){
  const pass=document.getElementById('login-pass').value;
  const errEl=document.getElementById('login-err');
  errEl.textContent='';
  let role;
  try{
    const res=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass})});
    if(!res.ok){const body=await res.json().catch(()=>({}));errEl.textContent='❌ '+(body.error||'No se pudo iniciar sesión');return}
    const data=await res.json();role=data.role;
  }catch(e){errEl.textContent='❌ Sin conexión con el servidor';return}
  currentRole=role;
  document.getElementById('login-overlay').style.display='none';
  if(role==='admin'){
    const overlay=document.getElementById('intro-overlay');
    const video=document.getElementById('intro-video');
    overlay.classList.add('active');
    video.currentTime=0;
    _startIntroCanvas(video);
    video.play().catch(()=>{_stopIntroCanvas();launchApp(role);});
    video.addEventListener('ended',()=>{
      _stopIntroCanvas();
      overlay.classList.add('fade-out');
      overlay.addEventListener('animationend',()=>{
        overlay.classList.remove('active','fade-out');
        launchApp(role);
      },{once:true});
    },{once:true});
  }else{
    launchApp(role);
  }
}
function launchApp(role){
  applyRole(role);
  init();
}
function applyRole(role){
  const rp=document.getElementById('role-pill');
  if(role==='viewer'){
    document.body.classList.add('viewer-mode');
    document.body.classList.remove('admin-mode');
    rp.className='viewer';rp.textContent='👁 Lectura';
    const sdr=document.getElementById('sd-role');
    if(sdr)sdr.innerHTML='<div style="padding:8px 18px;font-size:.72rem;color:rgba(255,255,255,.4)">👁 Solo lectura</div>';
    // Subtítulo catálogos en modo lectura
    const catSub=document.querySelector('#page-catalogos .psub');
    if(catSub)catSub.textContent='Solo lectura — contacta al administrador para hacer cambios';
  }else{
    document.body.classList.remove('viewer-mode');
    document.body.classList.add('admin-mode');
    rp.className='admin';rp.textContent='👤 Admin';
    const sdr=document.getElementById('sd-role');
    if(sdr)sdr.innerHTML='<div style="padding:8px 18px;font-size:.72rem;color:rgba(255,255,255,.4)">👤 Administrador</div>';
  }
}
async function cerrarSesion(){
  try{await fetch('/api/logout',{method:'POST'});}catch(e){}
  location.reload();
}
(async function(){
  try{
    const res=await fetch('/api/session');
    if(!res.ok)return;
    const data=await res.json();
    currentRole=data.role;
    document.getElementById('login-overlay').style.display='none';
    applyRole(data.role);
    init();
  }catch(e){}
})();

// ════════════════════════════════════════════
// API — persistencia en el backend propio (una sola fuente de verdad,
// sin sincronización dual con IndexedDB/Firebase)
// ════════════════════════════════════════════
function setSyncUI(state,msg){
  ['sdot','sdot2'].forEach(id=>{const d=document.getElementById(id);if(d){d.className='sdot'+(state==='ok'?'':state==='off'?' off':' sync')}});
  ['sync-txt','sync-txt2'].forEach(id=>{const t=document.getElementById(id);if(t)t.textContent=msg});
}
function updateConnUI(){
  setSyncUI(navigator.onLine?'ok':'off',navigator.onLine?'En línea ✓':'Sin conexión');
}

// Cola de reintentos: si un guardado falla por falta de red, se guarda aquí
// y se reintenta solo al volver la conexión, en vez de perder lo escrito.
const PENDING_KEY='pc_pending_writes';
function getPending(){try{return JSON.parse(localStorage.getItem(PENDING_KEY)||'[]')}catch(e){return[]}}
function setPending(arr){try{localStorage.setItem(PENDING_KEY,JSON.stringify(arr))}catch(e){}}
function queuePending(path,opts){const arr=getPending();arr.push({path,opts,ts:Date.now()});setPending(arr);}
async function flushPending(){
  if(!navigator.onLine)return;
  const arr=getPending();
  if(!arr.length)return;
  setSyncUI('sync','Guardando pendientes...');
  const remaining=[];
  for(const item of arr){
    try{await api(item.path,item.opts,{skipQueue:true});}
    catch(e){remaining.push(item);}
  }
  setPending(remaining);
  updateConnUI();
  if(remaining.length<arr.length)refreshPage();
  if(remaining.length)toast(`⚠ ${remaining.length} cambio(s) sin subir aún — se reintentará`,'var(--gold)');
}
window.addEventListener('online',flushPending);

async function api(path,opts={},{skipQueue}={}){
  const method=opts.method||'GET';
  let res;
  try{
    res=await fetch(path,{
      method,
      credentials:'same-origin',
      headers:opts.body?{'Content-Type':'application/json'}:undefined,
      body:opts.body?JSON.stringify(opts.body):undefined
    });
  }catch(networkErr){
    if(method!=='GET'&&!skipQueue){queuePending(path,opts);toast('⚠ Sin conexión — se guardará solo al volver la señal','var(--gold)');}
    updateConnUI();
    throw networkErr;
  }
  if(res.status===401){document.getElementById('login-overlay').style.display='flex';throw new Error('No autenticado')}
  if(!res.ok){const body=await res.json().catch(()=>({}));throw new Error(body.error||('Error '+res.status))}
  if(res.status===204)return null;
  return res.json();
}

function dbAll(store){return api(`/api/store/${store}`)}
function dbAdd(store,data){return api(`/api/store/${store}`,{method:'POST',body:data}).then(r=>r.id)}
function dbPut(store,data){const{id,...rest}=data;return api(`/api/store/${store}/${id}`,{method:'PUT',body:rest})}
function dbDel(store,id){return api(`/api/store/${store}/${id}`,{method:'DELETE'})}

function refreshPage(){
  const active=document.querySelector('.page.active')?.id?.replace('page-','');
  if(active==='dashboard')renderDash();
  else if(active==='insumos'){renderEntradas();renderSalidasIns();}
  else if(active==='produccion')renderProd();
  else if(active==='inventario')renderInv();
}

// ════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════
let cats={insumos:[],panes:[],pasteles:[]},editCtx=null,catFilters={insumos:'',panes:'',pasteles:''};
const DEF={
  encargados:[],destinos:[],
  insumos:Array.from({length:60},(_,i)=>["Harina de trigo","Levadura","Sal","Azúcar","Manteca / mantequilla","Huevos","Leche","Aceite vegetal","Harina especial (pastelería)","Crema pastelera","Azúcar en polvo","Cacao en polvo","Vainilla","Bicarbonato","Polvo de hornear","Colorante alimentario"][i]||`Insumo ${i+1}`),
  panes:Array.from({length:20},(_,i)=>["Pan francés","Pan de molde","Pan integral","Pan ciabatta","Pan brioche","Pan de leche","Pan especial","Pan tipo 8","Pan tipo 9","Pan tipo 10"][i]||`Pan tipo ${i+1}`),
  pasteles:Array.from({length:30},(_,i)=>["Torta de cumpleaños","Cupcake","Pie de manzana","Croissant","Empanada dulce","Cheesecake","Brownie","Muffin","Pastel de hojaldre","Producto especial","Pastel tipo 11","Pastel tipo 12","Pastel tipo 13","Pastel tipo 14","Pastel tipo 15"][i]||`Pastel tipo ${i+1}`)
};
const UNIT_LIST=['unidad','porcion','kilogramo','kilo','gramo','libra','litro','mililitro','docena','jaba','caja','bolsa','paquete','bandeja','plancha','lata','tarro','porongo','balde','casillero','pastel entero'];
function escAttr(v){return String(v??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escHtml(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function normalizeUnitList(value){
  const arr=Array.isArray(value)?value:String(value||'').split(',');
  return [...new Set(arr.map(u=>String(u||'').trim()).filter(Boolean))];
}
function toNum(v){const n=parseFloat(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0}
function fmtQty(n){const x=toNum(n);return Number.isInteger(x)?String(x):String(Math.round(x*1000)/1000)}
function parseMixedQty(value){
  if(typeof value==='number')return Number.isFinite(value)?value:0;
  const txt=String(value||'').trim().replace(',', '.');
  if(!txt)return 0;
  const parts=txt.split(/\s+/).filter(Boolean);
  const parsePart=part=>{
    const frac=String(part||'').split('/');
    if(frac.length===2){
      const num=toNum(frac[0]),den=toNum(frac[1]);
      return den>0?num/den:0;
    }
    return toNum(part);
  };
  if(parts.length===1)return parsePart(parts[0]);
  return parts.reduce((sum,part)=>sum+parsePart(part),0);
}
function fmtFractionQty(value){
  const x=toNum(value),whole=Math.floor(x),frac=x-whole;
  const quarters=[{v:.25,t:'1/4'},{v:.5,t:'1/2'},{v:.75,t:'3/4'}];
  const q=quarters.find(f=>Math.abs(frac-f.v)<.01);
  if(q)return `${whole?whole+' ':''}${q.t}`;
  if(Math.abs(frac)<.01)return String(whole);
  return fmtQty(x);
}
function fmtQtyByUnit(value,unit){
  return normTxt(unit)==='quintal'?fmtFractionQty(value):fmtQty(value);
}
function money(n){const x=toNum(n);return x>0?'S/. '+x.toFixed(2):'—'}
function factorFromText(value){
  if(typeof value==='number')return value>0?value:0;
  const txt=String(value??'').trim().replace(/,/g,'.');
  if(!txt)return 0;
  const parts=txt.split(/[xX*]/).map(p=>toNum(p)).filter(n=>n>0);
  if(parts.length)return parts.reduce((a,b)=>a*b,1);
  return toNum(txt);
}
function defaultUnitFor(key,name=''){
  const n=String(name).toLowerCase();
  if(key==='insumos'){
    if(/leche|aceite|vainilla|agua|crema/.test(n))return 'litro';
    if(/huevo/.test(n))return 'unidad';
    if(/harina|azucar|azúcar|azÃºcar|sal|cacao|polvo|manteca|mantequilla/.test(n))return 'kilogramo';
  }
  return 'unidad';
}
function normalizeEquivList(value){
  const raw=Array.isArray(value)?value:String(value||'').split(/\n|;/);
  const out=[];
  raw.forEach(item=>{
    let nombre='',unidad='',factor=0,detalle='';
    if(typeof item==='object'&&item){
      nombre=String(item.nombre||item.name||item.presentacion||item.label||'').trim();
      unidad=String(item.unidad||item.unit||nombre||'').trim();
      factor=factorFromText(item.factorBase??item.factor??item.equivalencia??item.value);
      detalle=String(item.detalle||item.detail||'').trim();
    }else{
      const parts=String(item||'').split('|').map(p=>p.trim());
      nombre=parts[0]||'';
      unidad=parts[1]||nombre;
      factor=factorFromText(parts[2]||'');
      detalle=parts[3]||'';
    }
    if(nombre&&factor>0)out.push({nombre,unidad:unidad||nombre,factor,detalle});
  });
  return out;
}
function equivsToText(arr){
  return normalizeEquivList(arr).map(e=>`${e.nombre} | ${e.unidad} | ${fmtQty(e.factor)}${e.detalle?` | ${e.detalle}`:''}`).join('\n');
}
function normalizeCats(src={}){
  const out={
    encargados:src.encargados||DEF.encargados,
    destinos:src.destinos||DEF.destinos,
    insumos:(src.insumos||DEF.insumos).map(x=>typeof x==='string'?x:(x.nombre||x.name||'')),
    panes:(src.panes||DEF.panes).map(x=>typeof x==='string'?x:(x.nombre||x.name||'')),
    pasteles:(src.pasteles||DEF.pasteles).map(x=>typeof x==='string'?x:(x.nombre||x.name||'')),
    unidades:{insumos:{},panes:{},pasteles:{}},
    baseUnits:{insumos:{},panes:{},pasteles:{}},
    equivalencias:{insumos:{},panes:{},pasteles:{}}
  };
  ['insumos','panes','pasteles'].forEach(key=>{
    (src[key]||[]).forEach(x=>{if(typeof x==='object'&&x){const nombre=x.nombre||x.name;if(nombre){out.unidades[key][nombre]=normalizeUnitList(x.unidad||x.unidades||x.unit||x.units);out.baseUnits[key][nombre]=String(x.unidadBase||x.baseUnit||'').trim();out.equivalencias[key][nombre]=normalizeEquivList(x.equivalencias||x.presentaciones)}}});
    const map=src.unidades?.[key]||src.units?.[key]||{};
    Object.keys(map).forEach(nombre=>{out.unidades[key][nombre]=normalizeUnitList(map[nombre])});
    const baseMap=src.baseUnits?.[key]||src.unidadesBase?.[key]||{};
    Object.keys(baseMap).forEach(nombre=>{out.baseUnits[key][nombre]=String(baseMap[nombre]||'').trim()});
    const eqMap=src.equivalencias?.[key]||src.presentaciones?.[key]||{};
    Object.keys(eqMap).forEach(nombre=>{out.equivalencias[key][nombre]=normalizeEquivList(eqMap[nombre])});
    out[key].forEach(nombre=>{
      if(!out.unidades[key][nombre]?.length)out.unidades[key][nombre]=[defaultUnitFor(key,nombre)];
      if(!out.baseUnits[key][nombre])out.baseUnits[key][nombre]=out.unidades[key][nombre][0]||defaultUnitFor(key,nombre);
      if(!out.equivalencias[key][nombre])out.equivalencias[key][nombre]=[];
    });
  });
  return out;
}
function getBaseUnit(key,name){return cats.baseUnits?.[key]?.[name]||getCatalogUnits(key,name)[0]||defaultUnitFor(key,name)}
function setBaseUnit(key,name,value){if(!cats.baseUnits)cats.baseUnits={insumos:{},panes:{},pasteles:{}};if(!cats.baseUnits[key])cats.baseUnits[key]={};cats.baseUnits[key][name]=(value||'').trim()||defaultUnitFor(key,name)}
function getEquivalencias(key,name){return normalizeEquivList(cats.equivalencias?.[key]?.[name]||[])}
function setEquivalencias(key,name,value){if(!cats.equivalencias)cats.equivalencias={insumos:{},panes:{},pasteles:{}};if(!cats.equivalencias[key])cats.equivalencias[key]={};cats.equivalencias[key][name]=normalizeEquivList(value)}
function getCatalogUnits(key,name){
  const base=normalizeUnitList(cats.unidades?.[key]?.[name]).length?normalizeUnitList(cats.unidades[key][name]):[defaultUnitFor(key,name)];
  if(key==='insumos'||key==='panes'||key==='pasteles')return base;
  const eq=getEquivalencias(key,name).map(e=>e.nombre);
  return [...new Set([...base,...eq])];
}
function getPracticalUnitLabel(key,name){
  const units=getCatalogUnits(key,name);
  return units.length?units.join(', '):getBaseUnit(key,name);
}
function getPrimaryPractical(key,name){
  const units=getCatalogUnits(key,name);
  const unit=units[0]||getBaseUnit(key,name);
  const factor=getEquivFactor(key,name,unit);
  return{unit,factor:factor>0?factor:1};
}
function toDispQty(baseQty,factor){return factor!==1?Math.round(baseQty/factor*1000)/1000:Math.round(baseQty*1000)/1000}
function setCatalogUnits(key,name,value){
  if(!cats.unidades)cats.unidades={insumos:{},panes:{},pasteles:{}};
  if(!cats.unidades[key])cats.unidades[key]={};
  const units=normalizeUnitList(value).length?normalizeUnitList(value):[defaultUnitFor(key,name)];
  cats.unidades[key][name]=units;
  if(key==='insumos'||key==='panes'||key==='pasteles'){
    if(!cats.baseUnits)cats.baseUnits={insumos:{},panes:{},pasteles:{}};
    if(!cats.baseUnits[key])cats.baseUnits[key]={};
    cats.baseUnits[key][name]=units[0]||defaultUnitFor(key,name);
  }
}
function renameCatItem(key,idx,value){
  const oldName=cats[key][idx],newName=(value||'').trim()||oldName;
  cats[key][idx]=newName;
  if(oldName!==newName&&cats.unidades?.[key]){
    cats.unidades[key][newName]=cats.unidades[key][oldName]||[defaultUnitFor(key,newName)];
    delete cats.unidades[key][oldName];
    if(cats.baseUnits?.[key]){cats.baseUnits[key][newName]=cats.baseUnits[key][oldName]||defaultUnitFor(key,newName);delete cats.baseUnits[key][oldName];}
    if(cats.equivalencias?.[key]){cats.equivalencias[key][newName]=cats.equivalencias[key][oldName]||[];delete cats.equivalencias[key][oldName];}
  }
}
function fillUnitSelect(select,key,name,current=''){
  if(!select)return;
  if(!name){select.innerHTML='<option value="">Selecciona producto...</option>';return}
  const units=getCatalogUnits(key,name);
  select.innerHTML=units.map(u=>`<option${u===current?' selected':''}>${escAttr(u)}</option>`).join('');
  if(current&&!units.includes(current))select.insertAdjacentHTML('afterbegin',`<option selected>${escAttr(current)}</option>`);
}
function updateCatalogUnitSelect(key,name,selectId){fillUnitSelect(document.getElementById(selectId),key,name)}
function updateSalidaUnitSelect(){
  const key=v('sp-cat')==='Panes'?'panes':(v('sp-cat')==='Pasteles'?'pasteles':'');
  fillUnitSelect(document.getElementById('sp-und'),key,v('sp-prod'));
}
function datalistSource(id){
  if(id==='insumos-options')return cats.insumos||[];
  if(id==='panes-options')return cats.panes||[];
  if(id==='pasteles-options')return cats.pasteles||[];
  if(id==='salida-prod-options')return v('sp-cat')==='Panes'?(cats.panes||[]):(v('sp-cat')==='Pasteles'?(cats.pasteles||[]):[]);
  if(id==='unit-options')return UNIT_LIST;
  return null;
}
function refreshDatalist(input){
  const id=input?.getAttribute?.('list');
  const src=datalistSource(id);
  const dl=id?document.getElementById(id):null;
  if(!src||!dl)return [];
  const q=(input.value||'').trim().toLowerCase();
  const arr=q?src.filter(n=>String(n).toLowerCase().includes(q)):src;
  dl.innerHTML=arr.map(n=>`<option value="${escAttr(n)}"></option>`).join('');
  return arr;
}
let acInput=null,acIndex=-1;
function acBox(){
  let box=document.getElementById('ac-list');
  if(!box){box=document.createElement('div');box.id='ac-list';box.className='ac-list';document.body.appendChild(box)}
  return box;
}
function hideAutocomplete(){const box=document.getElementById('ac-list');if(box)box.classList.remove('open');acInput=null;acIndex=-1}
function showAutocomplete(input){
  if(!input?.matches?.('input[list]'))return;
  const arr=refreshDatalist(input).slice(0,40);
  const box=acBox(),r=input.getBoundingClientRect();
  acInput=input;acIndex=-1;
  box.style.left=r.left+'px';box.style.top=(r.bottom+3)+'px';box.style.width=r.width+'px';
  box.innerHTML=arr.length?arr.map((n,i)=>`<div class="ac-item" data-i="${i}" data-v="${escAttr(n)}">${escHtml(n)}</div>`).join(''):'<div class="ac-empty">Sin opciones</div>';
  box.classList.add('open');
}
function pickAutocomplete(value){
  if(!acInput)return;
  acInput.value=value;
  acInput.dispatchEvent(new Event('input',{bubbles:true}));
  acInput.dispatchEvent(new Event('change',{bubbles:true}));
  hideAutocomplete();
}
function moveAutocomplete(delta){
  const box=document.getElementById('ac-list');
  const items=box?Array.from(box.querySelectorAll('.ac-item')):[];
  if(!items.length)return;
  acIndex=(acIndex+delta+items.length)%items.length;
  items.forEach((it,i)=>it.classList.toggle('active',i===acIndex));
  items[acIndex].scrollIntoView({block:'nearest'});
}
function updateInsumoLineUnit(select){
  const row=select.closest('.row-ins');
  refreshDatalist(select);
  fillUnitSelect(row?.querySelector('.lu'),'insumos',select.value);
  const baseInput=row?.querySelector('.lbu');
  if(baseInput&&!baseInput.value&&document.activeElement!==baseInput)baseInput.value=getBaseUnit('insumos',select.value);
  updateInsumoEquiv(row);
}
function catalogUnitInput(key,name){
  if(key==='insumos'||key==='panes'||key==='pasteles')return `<div class="cat-base-wrap"><span class="cat-mini-label">Unidad práctica</span><input type="text" list="unit-options" value="${escAttr(getCatalogUnits(key,name).join(', '))}" data-cat-unit="${key}" data-unit-name="${escAttr(name)}" onchange="setCatalogUnits('${key}',this.dataset.unitName,this.value);autoSaveCatalogos('✅ Unidad guardada')" placeholder="${key==='insumos'?'tarro, porongo, caja':'quintal, bandeja, caja'}"></div>`;
  return `<div class="cat-base-wrap"><span class="cat-mini-label">Base stock</span><input type="text" list="unit-options" value="${escAttr(getBaseUnit(key,name))}" data-cat-base="${key}" data-unit-name="${escAttr(name)}" onchange="setBaseUnit('${key}',this.dataset.unitName,this.value);autoSaveCatalogos('✅ Unidad guardada')" placeholder="kg, litro, unidad"></div>
    <div class="cat-equiv-wrap"><span class="cat-mini-label">Equivalencias: nombre | unidad | factor a base</span><textarea data-cat-equiv="${key}" data-unit-name="${escAttr(name)}" onchange="setEquivalencias('${key}',this.dataset.unitName,this.value);autoSaveCatalogos('✅ Equivalencias guardadas')" placeholder="saco 15 kg | saco | 15">${escHtml(equivsToText(getEquivalencias(key,name)))}</textarea></div>`;
}
function getEquivFactor(key,name,unidad){
  const eq=getEquivalencias(key,name).find(e=>e.nombre===unidad||e.unidad===unidad);
  return eq?.factor>0?eq.factor:1;
}
function getEquivDetail(key,name,unidad){
  const eq=getEquivalencias(key,name).find(e=>e.nombre===unidad||e.unidad===unidad);
  if(!eq)return '';
  return `${fmtQty(eq.factor)} ${getBaseUnit(key,name)} por ${eq.unidad||eq.nombre}`;
}
function baseQtyForRecord(rec,key,nameField='insumo'){
  if(Number.isFinite(rec.cantidadBase))return rec.cantidadBase;
  const name=rec[nameField]||rec.producto;
  return (parseFloat(rec.cantidad)||0)*getEquivFactor(key,name,rec.unidad);
}
function prodOutBaseQty(rec){
  if(Number.isFinite(rec.cantidadBase))return rec.cantidadBase;
  const key=rec.categoria==='Pasteles'?'pasteles':'panes';
  return (parseFloat(rec.cantidad)||0)*getEquivFactor(key,rec.producto,rec.unidad);
}
// ════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════
function hoy(){return new Date().toLocaleDateString('en-CA',{timeZone:'America/Lima'})}
function fmt(d){if(!d)return'';const[y,m,day]=d.split('-');return`${day}/${m}/${y}`}
function toast(msg,c='var(--green)'){const t=document.getElementById('toast');t.textContent=msg;t.style.background=c;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
function v(id){return(document.getElementById(id)||{}).value||''}
function setHoy(...ids){ids.forEach(id=>{const el=document.getElementById(id);if(el&&!el.value)el.value=hoy()})}
function empty(cols){return`<tr><td colspan="${cols}" class="empty">Sin registros</td></tr>`}
function navDia(filtroId,delta,renderFn){
  const el=document.getElementById(filtroId);
  const base=el.value||hoy();
  const d=new Date(base+'T12:00:00');
  d.setDate(d.getDate()+delta);
  el.value=d.toISOString().split('T')[0];
  renderFn();
}
function irHoyFiltro(filtroId,renderFn){
  document.getElementById(filtroId).value=hoy();
  renderFn();
}

// ════════════════════════════════════════════
// NAVEGACIÓN
// ════════════════════════════════════════════
function showPage(id,el){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item,.sni').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  // Activar en bottom nav
  const bn=document.getElementById('bnav-'+id);if(bn)bn.classList.add('active');
  // Activar en sidebar desktop
  if(el.classList.contains('sni'))el.classList.add('active');
  else{document.querySelectorAll('.sni').forEach(n=>{if(n.getAttribute('onclick')?.includes("'"+id+"'"))n.classList.add('active')})}
  // Scroll al top
  document.getElementById('main').scrollTop=0;
  window.scrollTo(0,0);
  setHoy('ent-fecha','sal-ins-fecha','pp-fecha','pa-fecha','sp-fecha','rep-desde','rep-hasta');
  if(id==='dashboard')renderDash();
  if(id==='inventario')renderInv();
  if(id==='insumos'){renderEntradas();renderSalidasIns()}
  if(id==='produccion')renderProd();
}
function switchTab(pre,tab,el){
  const pg=el.closest('.page');
  pg.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  pg.querySelectorAll('.tc').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(pre+'-tab-'+tab).classList.add('active');
}

// ════════════════════════════════════════════
// CATÁLOGOS
// ════════════════════════════════════════════
let catsId=null;
async function loadCats(){
  const rows=await dbAll('catalogos');
  if(rows.length){const s=rows[rows.length-1];catsId=s.id;cats=normalizeCats(s)}
  else cats=normalizeCats(DEF);
  renderCats();fillSelects();
}
function renderCats(){
  const g=document.getElementById('cat-grid');
  const isViewer=document.body.classList.contains('viewer-mode');
  const sec=(key,lbl,color,inputId)=>{
    const q=(catFilters[key]||'').trim().toLowerCase();
    const rows=cats[key].map((n,i)=>({n,i})).filter(x=>!q||String(x.n).toLowerCase().includes(q));
    return `<div class="cat-section">
    <div class="cat-title" style="color:${color}">${lbl}</div>
    <input class="cat-search" type="text" value="${escAttr(catFilters[key]||'')}" placeholder="Buscar ${key==='insumos'?'insumo':key==='panes'?'pan':'pastel'}..." oninput="filtrarCatalogo('${key}',this.value)">
    <div class="cat-items-grid">
      ${rows.length?rows.map(({n,i})=>`<div class="cat-item cat-unit-card">
        <span class="cat-item-num">${i+1}</span>
        <input type="text" value="${escAttr(n)}" data-cat="${key}" data-i="${i}" onchange="renameCatItem('${key}',${i},this.value);renderCats();autoSaveCatalogos('✅ Nombre guardado')">
        ${catalogUnitInput(key,n)}
        ${isViewer?'':'<button onclick="quitarCatItem(\''+key+'\','+i+')" style="border:none;background:none;color:var(--gray);cursor:pointer;font-size:.7rem;padding:0 2px;flex-shrink:0;line-height:1" title="Quitar">✕</button>'}
      </div>`).join(''):'<div class="cat-empty">Sin resultados</div>'}
    </div>
    ${isViewer?'':'<div class="add-item-row cat-add-row"><input class="add-item-input" type="text" id="'+inputId+'" placeholder="Nuevo elemento..."><input class="add-item-input" type="text" list="unit-options" id="'+inputId+'-unidad" placeholder="Unidad..."><button class="add-item-btn" style="background:'+color+'" onclick="agregarCatItem(\''+key+'\',\''+inputId+'\')">+ Agregar</button></div>'}
  </div>`};
  g.innerHTML='<datalist id="unit-options">'+UNIT_LIST.map(u=>`<option value="${escAttr(u)}"></option>`).join('')+'</datalist>'
             +sec('insumos','🌾 Insumos / Materia Prima','var(--orange)','new-insumo')
             +sec('panes','🍞 Tipos de Pan','var(--brown)','new-pan')
             +sec('pasteles','🎂 Pasteles / Repostería','var(--green)','new-pastel');
}
function filtrarCatalogo(key,value){
  catFilters[key]=value||'';
  renderCats();
  const input=document.querySelector(`.cat-search[oninput*="${key}"]`);
  if(input){
    input.focus();
    const len=input.value.length;
    input.setSelectionRange(len,len);
  }
}
async function quitarCatItem(key,idx){
  const nombre=cats[key][idx];
  if(!confirm(`¿Eliminar "${nombre}" del catálogo?`))return;
  cats[key].splice(idx,1);
  if(cats.unidades?.[key])delete cats.unidades[key][nombre];
  if(cats.baseUnits?.[key])delete cats.baseUnits[key][nombre];
  if(cats.equivalencias?.[key])delete cats.equivalencias[key][nombre];
  renderCats();
  await autoSaveCatalogos(`🗑 "${nombre}" eliminado`,'var(--red)');
}
async function agregarCatItem(key,inputId){
  const inp=document.getElementById(inputId);
  const val=(inp?.value||'').trim();
  if(!val){toast('⚠ Escribe un nombre','var(--red)');return}
  if(cats[key].includes(val)){toast('⚠ Ya existe en el catálogo','var(--gold)');return}
  const unidad=(document.getElementById(inputId+'-unidad')?.value||'').trim();
  cats[key].push(val);
  setCatalogUnits(key,val,unidad||defaultUnitFor(key,val));
  setBaseUnit(key,val,unidad||defaultUnitFor(key,val));
  inp.value='';
  const unitInp=document.getElementById(inputId+'-unidad');if(unitInp)unitInp.value='';
  renderCats();
  await autoSaveCatalogos(`✅ "${val}" agregado y guardado`);
}
// Guarda el catálogo completo en el servidor (fuente única de verdad).
async function saveCatalogos(){
  const rec={encargados:cats.encargados||[],destinos:cats.destinos||[],insumos:cats.insumos,panes:cats.panes,pasteles:cats.pasteles,unidades:cats.unidades||{insumos:{},panes:{},pasteles:{}},baseUnits:cats.baseUnits||{insumos:{},panes:{},pasteles:{}},equivalencias:cats.equivalencias||{insumos:{},panes:{},pasteles:{}}};
  if(catsId){rec.id=catsId;await dbPut('catalogos',rec)}
  else{catsId=await dbAdd('catalogos',rec)}
  fillSelects();
}
// Envuelve saveCatalogos con feedback claro: el cambio ya quedó en pantalla
// (cats en memoria), esto solo confirma que además se guardó en el servidor.
async function autoSaveCatalogos(successMsg,color){
  try{await saveCatalogos();toast(successMsg,color);}
  catch(e){if(!e?.queued)toast('❌ '+(e?.message||'No se pudo guardar, intenta de nuevo'),'var(--red)');}
}
function fillSelects(){
  const setList=(id,arr)=>{let dl=document.getElementById(id);if(!dl){dl=document.createElement('datalist');dl.id=id;document.body.appendChild(dl)}dl.innerHTML=(arr||[]).map(n=>`<option value="${escAttr(n)}"></option>`).join('')};
  setList('insumos-options',cats.insumos);
  setList('panes-options',cats.panes);
  setList('pasteles-options',cats.pasteles);
  updateCatalogUnitSelect('panes',v('pp-tipo'),'pp-und');
  updateCatalogUnitSelect('pasteles',v('pa-tipo'),'pa-und');
  updateProdEquiv('pp','panes');
  updateProdEquiv('pa','pasteles');
  renderProdPicker('pp','panes');
  renderProdPicker('pa','pasteles');
  updateSalidaUnitSelect();
  fillEncargados();renderListaEncargados();fillDestinos();renderListaDestinos();
}
document.addEventListener('input',e=>{
  if(e.target?.matches?.('input[list]'))showAutocomplete(e.target);
});
document.addEventListener('focusin',e=>{
  if(e.target?.matches?.('input[list]'))showAutocomplete(e.target);
});
document.addEventListener('click',e=>{
  if(e.target?.matches?.('input[list]')){showAutocomplete(e.target);return}
  if(e.target?.closest?.('#ac-list'))return;
  hideAutocomplete();
});
document.addEventListener('mousedown',e=>{
  const item=e.target?.closest?.('#ac-list .ac-item');
  if(item){e.preventDefault();pickAutocomplete(item.dataset.v||item.textContent||'')}
});
document.addEventListener('keydown',e=>{
  if(!acInput||document.activeElement!==acInput)return;
  if(e.key==='ArrowDown'){e.preventDefault();moveAutocomplete(1)}
  else if(e.key==='ArrowUp'){e.preventDefault();moveAutocomplete(-1)}
  else if(e.key==='Enter'){
    const item=document.querySelector('#ac-list .ac-item.active');
    if(item){e.preventDefault();pickAutocomplete(item.dataset.v||item.textContent||'')}
  }else if(e.key==='Escape')hideAutocomplete();
});
window.addEventListener('resize',()=>{if(acInput)showAutocomplete(acInput)});
window.addEventListener('scroll',()=>{if(acInput)showAutocomplete(acInput)},true);
function fillEncargados(){
  const s=document.getElementById('sp-encargado');if(!s)return;
  s.innerHTML='<option value="">Seleccionar...</option>'+(cats.encargados||[]).map(n=>`<option>${n}</option>`).join('');
}
function fillDestinos(){
  const s=document.getElementById('sp-dest');if(!s)return;
  s.innerHTML='<option value="">Seleccionar...</option>'+(cats.destinos||[]).map(n=>`<option>${n}</option>`).join('');
}
function renderListaDestinos(){
  const c=document.getElementById('lista-destinos');if(!c)return;
  const dest=cats.destinos||[];
  const isViewer=document.body.classList.contains('viewer-mode');
  c.innerHTML=dest.length?dest.map((n,i)=>`<div class="cat-item"><span class="cat-item-num">${i+1}</span><span style="flex:1">${n}</span>${isViewer?'':'<button onclick="quitarDestino('+i+')" style="border:none;background:none;color:var(--red);cursor:pointer;font-size:.85rem;padding:2px 8px;border-radius:4px">✕</button>'}</div>`).join(''):'<p style="color:var(--gray);font-size:.82rem;padding:8px 0">No hay destinos aún.</p>';
}
async function agregarDestino(){
  const inp=document.getElementById('new-destino');const val=(inp?.value||'').trim();
  if(!val){toast('⚠ Escribe un nombre','var(--red)');return}
  if((cats.destinos||[]).includes(val)){toast('⚠ Ya existe','var(--gold)');return}
  if(!cats.destinos)cats.destinos=[];cats.destinos.push(val);inp.value='';fillDestinos();renderListaDestinos();
  await autoSaveCatalogos(`✅ "${val}" agregado y guardado`);
}
async function quitarDestino(idx){
  const nombre=cats.destinos[idx];if(!confirm(`¿Eliminar destino "${nombre}"?`))return;
  cats.destinos.splice(idx,1);fillDestinos();renderListaDestinos();
  await autoSaveCatalogos(`🗑 "${nombre}" eliminado`,'var(--red)');
}
function renderListaEncargados(){
  const c=document.getElementById('lista-encargados');if(!c)return;
  const enc=cats.encargados||[];
  const isViewer=document.body.classList.contains('viewer-mode');
  c.innerHTML=enc.length?enc.map((n,i)=>`<div class="cat-item"><span class="cat-item-num">${i+1}</span><span style="flex:1">${n}</span>${isViewer?'':'<button onclick="quitarEncargado('+i+')" style="border:none;background:none;color:var(--red);cursor:pointer;font-size:.85rem;padding:2px 8px;border-radius:4px">✕</button>'}</div>`).join(''):'<p style="color:var(--gray);font-size:.82rem;padding:8px 0">No hay encargados aún.</p>';
}
async function agregarEncargado(){
  const inp=document.getElementById('new-encargado');const val=(inp?.value||'').trim();
  if(!val){toast('⚠ Escribe un nombre','var(--red)');return}
  if((cats.encargados||[]).includes(val)){toast('⚠ Ya existe','var(--gold)');return}
  if(!cats.encargados)cats.encargados=[];cats.encargados.push(val);inp.value='';fillEncargados();renderListaEncargados();
  await autoSaveCatalogos(`✅ "${val}" agregado y guardado`);
}
async function quitarEncargado(idx){
  const nombre=cats.encargados[idx];if(!confirm(`¿Eliminar encargado "${nombre}"?`))return;
  cats.encargados.splice(idx,1);fillEncargados();renderListaEncargados();
  await autoSaveCatalogos(`🗑 "${nombre}" eliminado`,'var(--red)');
}
function fillProdSelect(){
  const cat=v('sp-cat'),s=document.getElementById('sp-prod');
  let dl=document.getElementById('salida-prod-options');if(!dl){dl=document.createElement('datalist');dl.id='salida-prod-options';document.body.appendChild(dl)}
  if(!cat){if(s)s.value='';dl.innerHTML='';updateSalidaUnitSelect();return}
  const arr=cat==='Panes'?cats.panes:cats.pasteles;
  dl.innerHTML=arr.map(n=>`<option value="${escAttr(n)}"></option>`).join('');
  if(s&&s.value&&!arr.includes(s.value))s.value='';
  updateSalidaUnitSelect();
}

// ════════════════════════════════════════════
// LÍNEAS MÚLTIPLES DE INSUMOS
// ════════════════════════════════════════════
let lineaEntCnt=0,lineaSalCnt=0;
function mkInsLine(uid,containerId,showPrecio){
  return`<div class="row-ins" id="${containerId}-line-${uid}">
    <div class="fgrid">
      <div class="fg"><label>Insumo</label><input type="text" class="li" list="insumos-options" placeholder="Buscar insumo..." oninput="updateInsumoLineUnit(this)" onchange="updateInsumoLineUnit(this)"></div>
      <div class="fg"><label>Cantidad</label><input type="number" class="lc" min="0" step="0.01" placeholder="Ej: 3" oninput="updateInsumoEquiv(this.closest('.row-ins'))"></div>
      <div class="fg"><label>Presentación</label><select class="lu" onchange="updateInsumoEquiv(this.closest('.row-ins'))"><option value="">Selecciona insumo...</option></select></div>
      <div class="fg"><label>Trae</label><input type="number" class="lpack" min="0" step="0.01" placeholder="Ej: 6" oninput="updateInsumoEquiv(this.closest('.row-ins'))"></div>
      <div class="fg"><label>Unidad interna</label><input type="text" class="linner" placeholder="bolsita, tarro" oninput="updateInsumoEquiv(this.closest('.row-ins'))"></div>
      <div class="fg"><label>Contenido c/u</label><input type="number" class="lcont" min="0" step="0.0001" placeholder="Ej: 800" oninput="updateInsumoEquiv(this.closest('.row-ins'))"></div>
      <div class="fg"><label>Unidad base</label><input type="text" list="unit-options" class="lbu" placeholder="gramo, ml, kilo" oninput="updateInsumoEquiv(this.closest('.row-ins'))"></div>
      <input type="hidden" class="lf" value="1">
      <div class="fg"><label>Total base</label><input type="text" class="lb" readonly placeholder="0"></div>
      ${showPrecio?`<div class="fg"><label>Precio Total</label><input type="number" class="lpt" min="0" step="0.01" placeholder="0.00" oninput="updateInsumoEquiv(this.closest('.row-ins'));updateEntradaDocTotal()"></div><div class="fg"><label>Precio Unit.</label><input type="number" class="lp" min="0" step="0.01" placeholder="0.00" readonly></div>`:''}
      <div class="fg"><label>Obs.</label><input type="text" class="lo" placeholder="Opcional"></div>
    </div>
    <button class="row-ins-del" onclick="document.getElementById('${containerId}-line-${uid}').remove();updateEntradaDocTotal()">✕ Quitar este insumo</button>
  </div>`;
}
function addLineaEntrada(){lineaEntCnt++;document.getElementById('lineas-entrada').insertAdjacentHTML('beforeend',mkInsLine(lineaEntCnt,'lineas-entrada',true))}
function addLineaSalidaIns(){lineaSalCnt++;document.getElementById('lineas-salida-ins').insertAdjacentHTML('beforeend',mkInsLine(lineaSalCnt,'lineas-salida-ins',false))}
function updateInsumoEquiv(row){
  if(!row)return;
  const ins=row.querySelector('.li')?.value||'',unidad=row.querySelector('.lu')?.value||'';
  const cant=toNum(row.querySelector('.lc')?.value);
  const factorInput=row.querySelector('.lf');
  const catalogFactor=getEquivFactor('insumos',ins,unidad);
  const packInput=row.querySelector('.lpack');
  const innerInput=row.querySelector('.linner');
  const contentInput=row.querySelector('.lcont');
  const baseInput=row.querySelector('.lbu');
  if(baseInput&&!baseInput.value&&document.activeElement!==baseInput)baseInput.value=getBaseUnit('insumos',ins);
  const base=baseInput?.value||getBaseUnit('insumos',ins);
  if(packInput&&!packInput.value&&document.activeElement!==packInput)packInput.value='1';
  if(innerInput&&!innerInput.value&&document.activeElement!==innerInput)innerInput.value=unidad||'unidad';
  if(contentInput&&document.activeElement!==contentInput&&(contentInput.dataset.lastUnidad!==unidad||!contentInput.value)){
    contentInput.value=catalogFactor>0?fmtQty(catalogFactor):'1';
    contentInput.dataset.lastUnidad=unidad;
  }
  const pack=toNum(packInput?.value)||1;
  const content=toNum(contentInput?.value)||catalogFactor||1;
  const factor=pack*content;
  if(factorInput)factorInput.value=fmtQty(factor);
  const lb=row.querySelector('.lb');
  if(lb)lb.value=ins&&cant>0?`${fmtQty(cant*factor)} ${base}`:'';
  const totalInput=row.querySelector('.lpt');
  const unitInput=row.querySelector('.lp');
  if(totalInput&&unitInput){
    const total=toNum(totalInput.value);
    unitInput.value=total>0&&cant>0?fmtQty(total/cant):'';
  }
  updateEntradaDocTotal();
}
function updateEntradaDocTotal(){
  const totalEl=document.getElementById('ent-total-doc');
  if(!totalEl)return;
  const total=Array.from(document.querySelectorAll('#lineas-entrada .lpt')).reduce((sum,input)=>sum+toNum(input.value),0);
  totalEl.value=total>0?fmtQty(total):'';
}
function leerLineas(containerId){
  return Array.from(document.querySelectorAll('#'+containerId+' .row-ins')).map(row=>{
    const insumo=row.querySelector('.li')?.value||'',unidad=row.querySelector('.lu')?.value||'';
    const cantidad=toNum(row.querySelector('.lc')?.value);
    const pack=toNum(row.querySelector('.lpack')?.value)||1;
    const unidadInterna=(row.querySelector('.linner')?.value||'').trim()||unidad||'unidad';
    const contenido=toNum(row.querySelector('.lcont')?.value)||getEquivFactor('insumos',insumo,unidad)||1;
    const factor=pack*contenido;
    const unidadBase=(row.querySelector('.lbu')?.value||'').trim()||getBaseUnit('insumos',insumo);
    const precioTotal=toNum(row.querySelector('.lpt')?.value);
    const precio=toNum(row.querySelector('.lp')?.value)||(precioTotal>0&&cantidad>0?precioTotal/cantidad:0);
    return{
      insumo,unidad,cantidad,
      cantidadBase:cantidad*factor,unidadBase,
      factorBase:factor,packInterno:pack,unidadInterna,contenidoInterno:contenido,
      equivDetalle:`${fmtQty(pack)} ${unidadInterna} x ${fmtQty(contenido)} ${unidadBase} por ${unidad||'presentación'}`,
      precio,precioTotal,
      obs:row.querySelector('.lo')?.value||''
    };
  });
}
function insumoCantidadTexto(r){
  const unidadBase=r.unidadBase||getBaseUnit('insumos',r.insumo);
  const cantidadBase=Number.isFinite(r.cantidadBase)?r.cantidadBase:baseQtyForRecord(r,'insumos','insumo');
  const items=[];
  const add=(qty,unit,strong=false)=>{
    const q=toNum(qty),u=String(unit||'').trim();
    if(q<=0||!u)return;
    const exists=items.some(x=>normTxt(x.unit)===normTxt(u)&&Math.abs(toNum(x.qty)-q)<.0001);
    if(!exists)items.push({qty:q,unit:u,strong});
  };
  add(r.cantidad,r.unidad,true);
  const pack=toNum(r.packInterno)||1;
  const unidadInterna=String(r.unidadInterna||'').trim();
  if(unidadInterna&&(pack>1||normTxt(unidadInterna)!==normTxt(r.unidad)))add(toNum(r.cantidad)*pack,unidadInterna);
  add(cantidadBase,unidadBase);
  return items.map((x,i)=>i===0?`<b>${fmtQty(x.qty)} ${x.unit}</b>`:`<div style="color:var(--gray);font-size:.78rem">${fmtQty(x.qty)} ${x.unit}</div>`).join('');
}

// ════════════════════════════════════════════
// ENTRADAS DE INSUMOS
// ════════════════════════════════════════════
// OCR + IA para precargar entradas desde facturas o boletas.
let ocrFileInputActivo='';
const OCR_API_DEFAULT='https://pancontrol-ocr-ia.alvarocutitaco.workers.dev';
function initOCRConfig(){
  const el=document.getElementById('ocr-api-url');
  if(!el)return;
  const saved=localStorage.getItem('pancontrol_ocr_api_url');
  el.value=(!saved||saved==='/api/ocr-factura')?OCR_API_DEFAULT:saved;
  localStorage.setItem('pancontrol_ocr_api_url',el.value);
  el.addEventListener('change',()=>localStorage.setItem('pancontrol_ocr_api_url',el.value.trim()||OCR_API_DEFAULT));
}
function seleccionarOCR(source){
  const id=source==='gallery'?'ocr-doc-file-gallery':'ocr-doc-file-camera';
  document.getElementById(id)?.click();
}
function setOCRFileSource(id){
  ocrFileInputActivo=id;
  const file=document.getElementById(id)?.files?.[0];
  const label=document.getElementById('ocr-file-name');
  if(label)label.textContent=file?file.name:'Ningun archivo seleccionado';
}
function getOCRFile(){
  const active=document.getElementById(ocrFileInputActivo)?.files?.[0];
  return active||document.getElementById('ocr-doc-file-gallery')?.files?.[0]||document.getElementById('ocr-doc-file-camera')?.files?.[0]||null;
}
function isGalleryFile(){
  return ocrFileInputActivo==='ocr-doc-file-gallery';
}
function canvasToBlob(canvas,type='image/jpeg',quality=.86){
  return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
}
async function prepararImagenOCR(file){
  if(!file)return null;
  const isImage=(file.type||'').startsWith('image/');
  if(!isImage)return file;
  if(file.type==='image/heic'||file.type==='image/heif'){
    throw new Error('La imagen de galeria esta en formato HEIC/HEIF. Abrela en el celular y compartela/guardala como JPG, o toma una foto desde la camara de la app.');
  }
  if(!isGalleryFile()&&file.size<1600000)return file;
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    img.decoding='async';
    img.src=url;
    await img.decode();
    const maxSide=1800;
    const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await canvasToBlob(canvas,'image/jpeg',.86);
    if(!blob)return file;
    return new File([blob],(file.name||'factura').replace(/\.[^.]+$/, '')+'.jpg',{type:'image/jpeg'});
  }finally{
    URL.revokeObjectURL(url);
  }
}
function setOCRStatus(msg,type='warn'){
  const el=document.getElementById('ocr-status');
  if(!el)return;
  el.className=`ocr-status show ${type}`;
  el.textContent=msg;
}
function limpiarOCR(){
  const camera=document.getElementById('ocr-doc-file-camera');
  const gallery=document.getElementById('ocr-doc-file-gallery');
  const label=document.getElementById('ocr-file-name');
  const status=document.getElementById('ocr-status');
  if(camera)camera.value='';
  if(gallery)gallery.value='';
  if(label)label.textContent='Ningun archivo seleccionado';
  ocrFileInputActivo='';
  if(status){status.className='ocr-status';status.textContent=''}
}
function normTxt(value){
  return String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function mejorInsumoOCR(nombre){
  const q=normTxt(nombre);
  if(!q)return {value:'',score:0};
  let best={value:nombre,score:0};
  (cats.insumos||[]).forEach(ins=>{
    const n=normTxt(ins);
    let score=0;
    if(n===q)score=100;
    else if(n.includes(q)||q.includes(n))score=80;
    else{
      const qt=q.split(' ').filter(w=>w.length>2);
      const nt=new Set(n.split(' ').filter(w=>w.length>2));
      score=qt.length?Math.round((qt.filter(w=>nt.has(w)).length/qt.length)*70):0;
    }
    if(score>best.score)best={value:ins,score};
  });
  return best.score>=45?best:{value:nombre,score:0};
}
function ensureSelectOption(select,value){
  if(!select||!value)return;
  const exists=Array.from(select.options).some(o=>o.value===value);
  if(!exists)select.insertAdjacentHTML('beforeend',`<option value="${escAttr(value)}">${escHtml(value)}</option>`);
}
function mejorUnidadOCR(insumo,unidad){
  const q=normTxt(unidad);
  const opts=getCatalogUnits('insumos',insumo)||[];
  if(!q)return opts[0]||unidad||'';
  const found=opts.find(u=>normTxt(u)===q||normTxt(u).includes(q)||q.includes(normTxt(u)));
  return found||unidad;
}
function setRowOCR(row,item){
  const match=mejorInsumoOCR(item.insumo||item.descripcion||item.nombre||'');
  const ins=match.value||'';
  const unidad=mejorUnidadOCR(ins,item.presentacion||item.unidad||'');
  const cantidad=Number(item.cantidad||item.qty||0);
  const precioUnit=Number(item.precio_unitario||item.precio||item.pu||0);
  const totalRaw=Number(item.precio_total||item.total||item.importe||0);
  const total=totalRaw>0?totalRaw:(precioUnit>0&&cantidad>0?precioUnit*cantidad:0);
  row.querySelector('.li').value=ins;
  updateInsumoLineUnit(row.querySelector('.li'));
  ensureSelectOption(row.querySelector('.lu'),unidad);
  row.querySelector('.lu').value=unidad;
  row.querySelector('.lc').value=cantidad>0?cantidad:'';
  const pack=row.querySelector('.lpack');if(pack)pack.value=Number(item.trae||item.packInterno||0)>0?Number(item.trae||item.packInterno):'1';
  const inner=row.querySelector('.linner');if(inner)inner.value=item.unidad_interna||item.unidadInterna||unidad||'unidad';
  const content=row.querySelector('.lcont');if(content)content.value=Number(item.contenido_cu||item.contenidoInterno||0)>0?Number(item.contenido_cu||item.contenidoInterno):'1';
  const base=row.querySelector('.lbu');if(base)base.value=item.unidad_base||item.unidadBase||getBaseUnit('insumos',ins);
  const price=row.querySelector('.lpt');if(price)price.value=total>0?total:'';
  const obs=row.querySelector('.lo');
  if(obs){
    const notes=[];
    if(match.score<45)notes.push('Revisar insumo detectado por OCR');
    if(Number(item.confianza||1)<.75)notes.push('Baja confianza OCR');
    if(item.observacion)notes.push(item.observacion);
    if(item.descripcion_original&&item.descripcion_original!==ins)notes.push(`Original: ${item.descripcion_original}`);
    obs.value=notes.join(' | ');
  }
  updateInsumoEquiv(row);
}
function aplicarOCRAEntrada(data){
  const doc=data.documento||data;
  const items=data.insumos||doc.insumos||doc.items||doc.lineas||doc.detalle||[];
  if(doc.fecha)document.getElementById('ent-fecha').value=String(doc.fecha).slice(0,10);
  if(doc.tipo_documento||doc.tipo_doc||doc.tipodoc)document.getElementById('ent-tipodoc').value=doc.tipo_documento||doc.tipo_doc||doc.tipodoc;
  if(doc.numero_documento||doc.numdoc)document.getElementById('ent-numdoc').value=doc.numero_documento||doc.numdoc;
  if(doc.proveedor)document.getElementById('ent-prov').value=doc.proveedor;
  document.getElementById('lineas-entrada').innerHTML='';lineaEntCnt=0;
  items.forEach(item=>{
    addLineaEntrada();
    setRowOCR(document.querySelector('#lineas-entrada .row-ins:last-child'),item);
  });
  const total=Number(doc.total||doc.total_documento||0);
  if(total>0)document.getElementById('ent-total-doc').value=fmtQty(total);
  updateEntradaDocTotal();
  if(total>0)document.getElementById('ent-total-doc').value=fmtQty(total);
  const pendientes=Array.from(document.querySelectorAll('#lineas-entrada .lo')).filter(x=>x.value).length;
  const warns=Array.isArray(doc.advertencias)?doc.advertencias.filter(Boolean):[];
  setOCRStatus(`Documento cargado: ${items.length} linea(s). ${pendientes?pendientes+' insumo(s) necesitan revision.':'Revisa y corrige antes de guardar.'}${warns.length?' '+warns.join(' '):''}`,'ok');
}
async function analizarDocumentoEntrada(){
  const selectedFile=getOCRFile();
  const url=(document.getElementById('ocr-api-url')?.value||'').trim();
  if(!selectedFile){setOCRStatus('Selecciona o toma una foto de la factura o boleta.','err');return}
  if(!url){setOCRStatus('Configura la URL del servicio OCR + IA.','err');return}
  localStorage.setItem('pancontrol_ocr_api_url',url);
  try{
    setOCRStatus(isGalleryFile()?'Preparando imagen de galeria...':'Analizando documento...','warn');
    const file=await prepararImagenOCR(selectedFile);
    const form=new FormData();
    form.append('documento',file);
    form.append('catalogo_insumos',JSON.stringify(cats.insumos||[]));
    form.append('unidades',JSON.stringify(cats.unidades?.insumos||{}));
    setOCRStatus('Analizando documento...','warn');
    const res=await fetch(url,{method:'POST',body:form});
    const data=await res.json().catch(()=>null);
    if(!res.ok)throw new Error(data?.error||data?.detalle||`Servicio OCR respondio ${res.status}`);
    aplicarOCRAEntrada(data);
  }catch(e){
    setOCRStatus(`No se pudo analizar. Revisa que el backend OCR + IA este activo: ${e.message}`,'err');
  }
}
async function guardarEntrada(){
  const fecha=v('ent-fecha')||hoy(),tipodoc=v('ent-tipodoc'),numdoc=v('ent-numdoc'),prov=v('ent-prov');
  const lineas=leerLineas('lineas-entrada').filter(l=>l.insumo&&l.cantidad>0);
  if(!lineas.length){toast('⚠ Agrega al menos un insumo con cantidad','var(--red)');return}
  if(lineas.some(l=>!l.unidad||l.factorBase<=0||l.cantidadBase<=0)){toast('⚠ Revisa presentación y equivalencia','var(--red)');return}
  const totalDoc=toNum(v('ent-total-doc'))||lineas.reduce((sum,l)=>sum+(l.precioTotal||0),0);
  try{
    for(const l of lineas){
      const data={fecha,tipodoc,numdoc,proveedor:prov,insumo:l.insumo,unidad:l.unidad,cantidad:l.cantidad,cantidadBase:l.cantidadBase,unidadBase:l.unidadBase,factorBase:l.factorBase,packInterno:l.packInterno||1,unidadInterna:l.unidadInterna||'',contenidoInterno:l.contenidoInterno||0,equivDetalle:l.equivDetalle,precio:l.precio||0,precioTotal:l.precioTotal||0,totalDoc,obs:l.obs||''};
      await dbAdd('entradas',data);
    }
  }catch(e){if(!e?.queued){toast('❌ '+(e?.message||'No se pudo guardar'),'var(--red)');return}}
  document.getElementById('lineas-entrada').innerHTML='';lineaEntCnt=0;
  ['ent-tipodoc','ent-numdoc','ent-prov','ent-total-doc'].forEach(id=>{const el=document.getElementById(id);if(el.tagName==='SELECT')el.selectedIndex=0;else el.value=''});
  toast(`✅ ${lineas.length} insumo(s) registrados`);renderEntradas();addLineaEntrada();
}
async function renderEntradas(){
  const rows=await dbAll('entradas');
  const fEl=document.getElementById('ent-filtro');
  if(!fEl.value)fEl.value=hoy();
  const f=fEl.value;
  const data=rows.filter(r=>r.fecha===f).reverse();
  const tb=document.querySelector('#ent-table tbody');
  if(!data.length){tb.innerHTML=empty(13);return}
  tb.innerHTML=data.map((r,i)=>`<tr>
    <td>${i+1}</td><td>${fmt(r.fecha)}</td>
    <td><span class="badge bins">${r.tipodoc||'—'}</span></td>
    <td>${r.numdoc||'—'}</td><td><b>${r.insumo}</b></td>
    <td>${insumoCantidadTexto(r)}</td>
    <td>${money(r.precio)}</td>
    <td>${money(r.precioTotal||((r.precio||0)*(r.cantidad||0)))}</td>
    <td>${money(r.totalDoc)}</td>
    <td>${r.proveedor||'—'}</td><td>${r.obs||'—'}</td>
    <td><button class="btn bsec bsm edit-btn" onclick="openEdit('entradas',${r.id})">✏️</button></td>
    <td><button class="btn br bsm del-btn" onclick="del('entradas',${r.id},renderEntradas)">🗑</button></td>
  </tr>`).join('');
}

// ════════════════════════════════════════════
// SALIDAS DE INSUMOS
// ════════════════════════════════════════════
async function guardarSalidaIns(){
  const fecha=v('sal-ins-fecha')||hoy(),motivo=v('sal-ins-motivo'),ticket=v('sal-ins-ticket'),obs=v('sal-ins-obs');
  const lineas=leerLineas('lineas-salida-ins').filter(l=>l.insumo&&l.cantidad>0);
  if(!lineas.length){toast('⚠ Agrega al menos un insumo con cantidad','var(--red)');return}
  if(lineas.some(l=>!l.unidad||l.factorBase<=0||l.cantidadBase<=0)){toast('⚠ Revisa presentación y equivalencia','var(--red)');return}
  try{
    for(const l of lineas){
      const data={fecha,motivo,ticket,obs,insumo:l.insumo,unidad:l.unidad,cantidad:l.cantidad,cantidadBase:l.cantidadBase,unidadBase:l.unidadBase,factorBase:l.factorBase,packInterno:l.packInterno||1,unidadInterna:l.unidadInterna||'',contenidoInterno:l.contenidoInterno||0,equivDetalle:l.equivDetalle,obs_linea:l.obs||''};
      await dbAdd('salidas_ins',data);
    }
  }catch(e){if(!e?.queued){toast('❌ '+(e?.message||'No se pudo guardar'),'var(--red)');return}}
  document.getElementById('lineas-salida-ins').innerHTML='';lineaSalCnt=0;
  ['sal-ins-motivo','sal-ins-ticket','sal-ins-obs'].forEach(id=>{const el=document.getElementById(id);if(el.tagName==='SELECT')el.selectedIndex=0;else el.value=''});
  toast(`✅ ${lineas.length} insumo(s) registrados`);renderSalidasIns();addLineaSalidaIns();
}
async function renderSalidasIns(){
  const rows=await dbAll('salidas_ins');
  const fEl=document.getElementById('sal-ins-filtro');
  if(!fEl.value)fEl.value=hoy();
  const f=fEl.value;
  const data=rows.filter(r=>r.fecha===f).reverse();
  const tb=document.querySelector('#sal-ins-table tbody');
  if(!data.length){tb.innerHTML=empty(9);return}
  tb.innerHTML=data.map((r,i)=>`<tr>
    <td>${i+1}</td><td>${fmt(r.fecha)}</td>
    <td><span class="badge bsal">${r.motivo||'—'}</span></td>
    <td>${r.ticket||'—'}</td><td><b>${r.insumo}</b></td>
    <td>${insumoCantidadTexto(r)}</td>
    <td>${r.obs||r.obs_linea||'—'}</td>
    <td><button class="btn bsec bsm edit-btn" onclick="openEdit('salidas_ins',${r.id})">✏️</button></td>
    <td><button class="btn br bsm del-btn" onclick="del('salidas_ins',${r.id},renderSalidasIns)">🗑</button></td>
  </tr>`).join('');
}

// ════════════════════════════════════════════
// PRODUCCIÓN
// ════════════════════════════════════════════
function setPanFixedUnits(){
  const und=document.getElementById('pp-und');
  if(und)und.value='lata';
  const teo=document.getElementById('pp-teo-und');
  if(teo)teo.value='quintal';
  const sub=document.getElementById('pp-sub-und');
  if(sub)sub.value='unidades';
}
function setPastelFixedUnits(){
  const und=document.getElementById('pa-und');
  if(und)und.value='unidad';
  const teo=document.getElementById('pa-teo-und');
  if(teo)teo.value='unidad';
  const sub=document.getElementById('pa-sub-und');
  if(sub)sub.value='unidad';
}
// Selector visual de productos (cuadros táctiles). Es aditivo: solo escribe el
// nombre en el input existente y dispara la MISMA lógica de siempre.
function renderProdPicker(pre,key){
  const el=document.getElementById(pre+'-picker');if(!el)return;
  const arr=cats[key]||[];const cur=v(pre+'-tipo');const emoji=key==='panes'?'🍞':'🎂';
  el.innerHTML=arr.map(n=>`<button type="button" class="prod-chip${n===cur?' sel':''}" data-n="${escAttr(n)}" onclick="pickProd('${pre}','${key}',this.dataset.n)"><span class="pc-emoji">${emoji}</span><span class="pc-nm">${escHtml(n)}</span></button>`).join('');
}
function pickProd(pre,key,name){
  const inp=document.getElementById(pre+'-tipo');if(inp)inp.value=name;
  updateProdEquiv(pre,key);
  renderProdPicker(pre,key);
}
function updateProdEquiv(pre,key){
  if(pre==='pp'){setPanFixedUnits();calcProdBase(pre);return}
  if(pre==='pa'){setPastelFixedUnits();calcProdBase(pre);return}
  const producto=v(pre+'-tipo'),unidad=v(pre+'-und');
  const teo=document.getElementById(pre+'-teo-und'),sub=document.getElementById(pre+'-sub-und');
  if(teo&&!teo.value&&document.activeElement!==teo)teo.value=pre==='pp'?'lata':'bandeja';
  if(sub&&!sub.value&&document.activeElement!==sub)sub.value=getBaseUnit(key,producto)||'unidad';
  calcProdBase(pre);
}
function calcLatasAuto(){
  const latas=toNum(v('pp-pres-cant')),porLata=toNum(v('pp-por-lata'));
  if(latas>0&&porLata>0){const cantEl=document.getElementById('pp-cant');if(cantEl)cantEl.value=latas*porLata;}
  calcProdBase('pp');
}
function prodFactorFromInputs(pre){
  const pres=toNum(v(pre+'-pres-cant')),cant=toNum(v(pre+'-cant'));
  return pres>0&&cant>0?cant/pres:1;
}
function calcProdBase(pre){
  if(pre==='pp'){setPanFixedUnits();return}
  if(pre==='pa'){
    setPastelFixedUnits();
    const cant=v('pa-cant')||'0';
    const pres=document.getElementById('pa-pres-cant');
    const teoCant=document.getElementById('pa-eq-a');
    if(pres)pres.value=cant;
    if(teoCant)teoCant.value=cant;
    return;
  }
  const teo=document.getElementById(pre+'-teo-und'),sub=document.getElementById(pre+'-sub-und');
  if(teo&&!teo.value&&document.activeElement!==teo)teo.value=pre==='pp'?'lata':'bandeja';
  if(sub&&!sub.value&&document.activeElement!==sub)sub.value='unidad';
}
function prodCantidadTeorica(rec){
  if(Number.isFinite(rec.cantidadTeorica))return rec.cantidadTeorica;
  return (parseFloat(rec.cantidadPresentacion)||parseFloat(rec.cantidad)||0)*(parseFloat(rec.eqA)||1);
}
function prodCantidadTexto(r){
  const latasNum=fmtQty(r.cantidadPresentacion||r.cantidad);
  const latasUnit=r.unidad||'';
  const pract=r.porLata>0?`${latasNum} ${latasUnit} x${fmtQty(r.porLata)} uni`:`${latasNum} ${latasUnit}`;
  const unidadTeorica=r.unidadTeorica||(r.tipo==='pan'?'quintal':'lata');
  const teor=`${fmtQtyByUnit(prodCantidadTeorica(r),unidadTeorica)} ${unidadTeorica}`;
  const sub=`${fmtQty(r.cantidad)} ${r.unidadSub||r.unidadBase||getBaseUnit(r.tipo==='pastel'?'pasteles':'panes',r.producto)}`;
  return `<b>${pract}</b><div style="font-size:.68rem;color:var(--gray)">${teor} - ${sub}</div>`;
}
async function guardarProd(tipo){
  const pre=tipo==='pan'?'pp':'pa',key=tipo==='pan'?'panes':'pasteles';
  calcProdBase(pre);
  const cant=toNum(v(pre+'-cant')),def=toNum(v(pre+'-def'));
  const presCant=toNum(v(pre+'-pres-cant')),teoCant=tipo==='pan'?parseMixedQty(v(pre+'-eq-a')):toNum(v(pre+'-eq-a')),factor=prodFactorFromInputs(pre);
  if(!v(pre+'-tipo')||cant<=0){toast('⚠ Completa tipo y cantidad','var(--red)');return}
  if(def<0||def>cant){toast('⚠ Revisa cantidad defectuosa','var(--red)');return}
  if(presCant<=0||teoCant<0||(tipo==='pan'&&teoCant<=0)){toast('⚠ Revisa cantidades de producción','var(--red)');return}
  const unidadBase=v(pre+'-sub-und')||getBaseUnit(key,v(pre+'-tipo'));
  const eqB=teoCant>0?cant/teoCant:0;
  const porLata=tipo==='pan'?toNum(v('pp-por-lata')):0;
  const data={tipo,fecha:v(pre+'-fecha')||hoy(),turno:v(pre+'-turno'),producto:v(pre+'-tipo'),unidad:v(pre+'-und'),cantidad:cant,cantidadPresentacion:presCant,unidadTeorica:v(pre+'-teo-und')||(tipo==='pan'?'lata':'bandeja'),cantidadTeorica:teoCant,unidadSub:unidadBase,factorBase:factor,unidadBase,eqA:teoCant,eqB,defectuosa:def,neto:cant-def,obs:v(pre+'-obs'),...(porLata>0?{porLata}:{})};
  try{await dbAdd('produccion',data);}catch(e){if(!e?.queued){toast('❌ '+(e?.message||'No se pudo guardar'),'var(--red)');return}}
  [pre+'-turno',pre+'-tipo',pre+'-und',pre+'-pres-cant',pre+'-teo-und',pre+'-eq-a',pre+'-sub-und',pre+'-cant',pre+'-def',pre+'-obs'].forEach(id=>{const el=document.getElementById(id);if(el.tagName==='SELECT')el.selectedIndex=0;else el.value=''});
  const plEl=document.getElementById('pp-por-lata');if(plEl)plEl.value='';
  if(tipo==='pan')setPanFixedUnits();else setPastelFixedUnits();
  renderProdPicker(pre,key);
  toast('✅ Producción registrada');renderProd();
}
async function renderProd(){
  const rows=await dbAll('produccion');
  const fpEl=document.getElementById('pp-filtro');const fpaEl=document.getElementById('pa-filtro');
  if(!fpEl.value)fpEl.value=hoy();
  if(!fpaEl.value)fpaEl.value=hoy();
  const fp=fpEl.value,fpa=fpaEl.value;
  const mk=(data,tbId)=>{
    const tb=document.querySelector('#'+tbId+' tbody');if(!data.length){tb.innerHTML=empty(10);return}
    tb.innerHTML=data.map((r,i)=>`<tr>
      <td>${i+1}</td><td>${fmt(r.fecha)}</td><td>${r.turno||'—'}</td>
      <td><b>${r.producto}</b></td>
      <td>${prodCantidadTexto(r)}</td><td style="color:var(--red)">${fmtQty(r.defectuosa||0)}</td>
      <td><b style="color:var(--green)">${r.neto}</b></td><td>${r.obs||'—'}</td>
      <td><button class="btn bsec bsm edit-btn" onclick="openEdit('produccion',${r.id})">✏️</button></td>
      <td><button class="btn br bsm del-btn" onclick="del('produccion',${r.id},renderProd)">🗑</button></td>
    </tr>`).join('');
  };
  mk(rows.filter(r=>r.tipo==='pan'&&r.fecha===fp).reverse(),'prod-panes-t');
  mk(rows.filter(r=>r.tipo==='pastel'&&r.fecha===fpa).reverse(),'prod-past-t');
}

// ════════════════════════════════════════════
// SALIDA DE PRODUCTOS
// ════════════════════════════════════════════
async function guardarSalidaProd(){
  const cant=toNum(v('sp-cant'));
  if(!v('sp-prod')||cant<=0){toast('⚠ Completa producto y cantidad','var(--red)');return}
  const key=v('sp-cat')==='Panes'?'panes':'pasteles';
  const factor=getEquivFactor(key,v('sp-prod'),v('sp-und'));
  if(factor<=0){toast('⚠ Revisa presentación y equivalencia','var(--red)');return}
  const data={fecha:v('sp-fecha')||hoy(),categoria:v('sp-cat'),producto:v('sp-prod'),unidad:v('sp-und'),cantidad:cant,cantidadBase:cant*factor,unidadBase:getBaseUnit(key,v('sp-prod')),factorBase:factor,destino:v('sp-dest'),encargado:v('sp-encargado'),documento:v('sp-doc'),obs:v('sp-obs')};
  try{await dbAdd('salida_prod',data);}catch(e){if(!e?.queued){toast('❌ '+(e?.message||'No se pudo guardar'),'var(--red)');return}}
  ['sp-cat','sp-prod','sp-und','sp-cant','sp-dest','sp-encargado','sp-doc','sp-obs'].forEach(id=>{const el=document.getElementById(id);if(el.tagName==='SELECT')el.selectedIndex=0;else el.value=''});
  updateSalidaUnitSelect();
  toast('✅ Salida registrada');renderSalidaProd();renderInvProd();fillProdSelect();
}
async function renderSalidaProd(){
  const rows=await dbAll('salida_prod');
  const fEl=document.getElementById('sp-filtro');
  if(!fEl.value)fEl.value=hoy();
  const f=fEl.value;
  const data=rows.filter(r=>r.fecha===f).reverse();
  const tb=document.querySelector('#sp-table tbody');
  if(!data.length){tb.innerHTML=empty(11);return}
  tb.innerHTML=data.map((r,i)=>`<tr>
    <td>${i+1}</td><td>${fmt(r.fecha)}</td>
    <td><span class="badge ${r.categoria==='Panes'?'bpan':'bpast'}">${r.categoria||'—'}</span></td>
    <td><b>${r.producto}</b></td><td>${r.unidad||'—'}${r.factorBase&&r.factorBase!==1?`<div style="font-size:.65rem;color:var(--gray)">x ${fmtQty(r.factorBase)} ${r.unidadBase||getBaseUnit(r.categoria==='Pasteles'?'pasteles':'panes',r.producto)}</div>`:''}</td>
    <td>${r.cantidad}${r.cantidadBase&&r.cantidadBase!==r.cantidad?`<div style="font-size:.65rem;color:var(--green)">${fmtQty(r.cantidadBase)} ${r.unidadBase||''}</div>`:''}</td><td>${r.destino||'—'}</td>
    <td>${r.encargado||'—'}</td><td>${r.documento||'—'}</td><td>${r.obs||'—'}</td>
    <td><button class="btn bsec bsm edit-btn" onclick="openEdit('salida_prod',${r.id})">✏️</button></td>
    <td><button class="btn br bsm del-btn" onclick="del('salida_prod',${r.id},renderSalidaProd)">🗑</button></td>
  </tr>`).join('');
}

// ════════════════════════════════════════════
// INVENTARIO — VISTA MEJORADA
// ════════════════════════════════════════════
let _invInsData=[], _invInsSort='stock';

async function renderInv(){
  const[ent,sal,invR]=await Promise.all([dbAll('entradas'),dbAll('salidas_ins'),dbAll('inventario')]);
  const getInv=key=>{const r=invR.find(r=>r.key===key);return r||{key,si:0,aj:0,min:0}};

  // Construir datos insumos
  _invInsData=cats.insumos.map((n,i)=>{
    const e=ent.filter(r=>r.insumo===n).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);
    const s=sal.filter(r=>r.insumo===n).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);
    const inv=getInv('ins_'+n);
    const stock=(inv.si||0)+e-s+(inv.aj||0);
    const min=inv.min||0;
    const pp=getPrimaryPractical('insumos',n);
    return{idx:i,n,e,s,stock,min,inv,baseUnit:getBaseUnit('insumos',n),unitLabel:getPracticalUnitLabel('insumos',n),primaryUnit:pp.unit,primaryFactor:pp.factor,eDisp:toDispQty(e,pp.factor),sDisp:toDispQty(s,pp.factor),stockDisp:toDispQty(stock,pp.factor),minDisp:toDispQty(min,pp.factor),low:min>0&&stock<=min,mid:min>0&&stock>min&&stock<=min*1.5};
  });

  // Badge de alertas
  const lowCount=_invInsData.filter(x=>x.low).length;
  const badge=document.getElementById('inv-ins-badge');
  if(badge) badge.innerHTML=lowCount>0?`<span class="inv-count-badge">${lowCount}</span>`:'';

  _renderInvIns();
}

function _sortedIns(q){
  let arr=[..._invInsData];
  if(q){const lq=q.toLowerCase();arr=arr.filter(x=>x.n.toLowerCase().includes(lq));}
  if(_invInsSort==='stock') arr.sort((a,b)=>a.stock-b.stock);
  else arr.sort((a,b)=>a.n.localeCompare(b.n,'es'));
  return arr;
}
function _renderInvIns(){
  const q=(document.getElementById('inv-ins-search')||{}).value||'';
  const arr=_sortedIns(q);
  const tb=document.getElementById('inv-ins-tbody');
  if(!arr.length){tb.innerHTML=`<tr><td colspan="5" class="empty">Sin resultados</td></tr>`;return}
  tb.innerHTML=arr.map(x=>{
    const pct=x.min>0?Math.min(100,Math.round(x.stock/x.min*100)):null;
    const barCls=pct===null?'':pct<=50?'low':pct<=100?'mid':'';
    const barColor=barCls==='low'?'var(--red)':barCls==='mid'?'var(--gold)':'var(--green2)';
    const stockCls=x.low?'inv-stock-low':x.mid?'inv-stock-mid':'inv-stock-ok';
    const statusIcon=x.low?'🔴':x.mid?'🟡':'🟢';
    return`<tr class="inv-summary-row${x.low?' low-row':''}" onclick="toggleInvEdit('ins','${x.idx}',this)">
      <td><div class="inv-name-main">${x.n}</div></td>
      <td style="text-align:center;color:var(--green);font-weight:600">${fmtQty(x.eDisp)}<div style="font-size:.65rem;color:var(--gray)">${escHtml(x.primaryUnit)}</div></td>
      <td style="text-align:center;color:var(--red);font-weight:600">${fmtQty(x.sDisp)}<div style="font-size:.65rem;color:var(--gray)">${escHtml(x.primaryUnit)}</div></td>
      <td style="text-align:center"><span class="inv-stock-val ${stockCls}">${fmtQty(x.stockDisp)}</span><div style="font-size:.65rem;color:var(--gray)">${escHtml(x.primaryUnit)}${x.min>0?` · min ${fmtQty(x.minDisp)}`:''}</div></td>
      <td>${statusIcon} ${x.low?'<b style="color:var(--red);font-size:.75rem">Bajo mínimo</b>':x.mid?'<span style="color:var(--gold);font-size:.75rem">Por reponer</span>':'<span style="color:var(--green);font-size:.75rem">OK</span>'}
        ${pct!==null?`<div class="inv-bar-sm"><div class="inv-bar-sm-fill" style="width:${pct}%;background:${barColor}"></div></div>`:''}
      </td>
    </tr>
    <tr class="inv-edit-panel" id="inv-edit-ins-${x.idx}">
      <td colspan="5">
        <div class="inv-edit-inner" data-rowtype="ins" data-rowidx="${x.idx}" data-factor="${x.primaryFactor}">
          <div class="fg"><label>Stock Inicial (${escHtml(x.primaryUnit)})</label><input type="number" class="inv-mini-input inv-si" value="${fmtQty(toDispQty(x.inv.si||0,x.primaryFactor))}" min="0" step="any"></div>
          <div class="fg"><label>Ajuste ± (${escHtml(x.primaryUnit)})</label><input type="number" class="inv-mini-input inv-aj" value="${fmtQty(toDispQty(x.inv.aj||0,x.primaryFactor))}" step="any"></div>
          <div class="fg"><label>Mínimo (${escHtml(x.primaryUnit)})</label><input type="number" class="inv-mini-input inv-mn" value="${fmtQty(toDispQty(x.min,x.primaryFactor))}" min="0" step="any"></div>
          <button class="btn bp bsm" style="white-space:nowrap;align-self:flex-end" onclick="saveInvFromPanel(this)">💾 Guardar</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleInvEdit(tipo,idx,row){
  // Viewer no puede abrir panel de edición
  if(document.body.classList.contains('viewer-mode'))return;
  // Si el click viene de dentro del panel, no cerrar
  if(row.classList.contains('inv-summary-row')){
    const panelId='inv-edit-'+tipo+'-'+idx;
    const panel=document.getElementById(panelId);
    if(!panel)return;
    const isOpen=panel.classList.contains('open');
    // Cerrar todos los paneles del mismo tbody
    const tbody=row.closest('tbody');
    tbody.querySelectorAll('.inv-edit-panel.open').forEach(p=>p.classList.remove('open'));
    if(!isOpen) panel.classList.add('open');
  }
}

function filterInv(tipo){
  if(tipo==='ins') _renderInvIns();
}

function sortInv(tipo,mode){
  if(tipo==='ins'){
    _invInsSort=mode;
    document.getElementById('inv-ins-sort-stock').classList.toggle('active',mode==='stock');
    document.getElementById('inv-ins-sort-az').classList.toggle('active',mode==='az');
    _renderInvIns();
  }
}

// ── INVENTARIO DE PRODUCTOS ──
let _invProdData=[], _invProdSort='stock';

async function renderInvProd(){
  fillEncargados();fillDestinos();
  const[prod,sp,invR]=await Promise.all([dbAll('produccion'),dbAll('salida_prod'),dbAll('inventario')]);
  const getInv=key=>{const r=invR.find(r=>r.key===key);return r||{key,si:0,aj:0}};
  const allProds=[...cats.panes.map(n=>({n,key:'panes'})),...cats.pasteles.map(n=>({n,key:'pasteles'}))];
  _invProdData=allProds.map((p,i)=>{
    const e=prod.filter(r=>r.producto===p.n).reduce((s,r)=>s+(r.neto||0),0);
    const s=sp.filter(r=>r.producto===p.n).reduce((s,r)=>s+prodOutBaseQty(r),0);
    const inv=getInv('prod_'+p.n);
    const stock=(inv.si||0)+e-s+(inv.aj||0);
    const pp=getPrimaryPractical(p.key,p.n);
    return{idx:i,n:p.n,catKey:p.key,e,s,stock,inv,primaryUnit:pp.unit,primaryFactor:pp.factor,eDisp:toDispQty(e,pp.factor),sDisp:toDispQty(s,pp.factor),stockDisp:toDispQty(stock,pp.factor)};
  });
  _renderInvProd();
  renderSalidaProd();
}

function _renderInvProd(){
  const tb=document.getElementById('inv-prod-tbody');
  if(!tb)return;
  let arr=[..._invProdData];
  if(_invProdSort==='stock')arr.sort((a,b)=>a.stock-b.stock);
  else arr.sort((a,b)=>a.n.localeCompare(b.n,'es'));
  if(!arr.length){tb.innerHTML=`<tr><td colspan="4" class="empty">Sin productos en catálogo</td></tr>`;return}
  tb.innerHTML=arr.map(x=>{
    const stockCls=x.stock<=0?'inv-stock-low':'inv-stock-ok';
    return`<tr>
      <td><b>${x.n}</b><div style="font-size:.65rem;color:var(--gray)">${x.catKey==='panes'?'Panes':'Pasteles'}</div></td>
      <td style="text-align:center;color:var(--green);font-weight:600">${fmtQty(x.eDisp)}<div style="font-size:.65rem;color:var(--gray)">${escHtml(x.primaryUnit)}</div></td>
      <td style="text-align:center;color:var(--red);font-weight:600">${fmtQty(x.sDisp)}<div style="font-size:.65rem;color:var(--gray)">${escHtml(x.primaryUnit)}</div></td>
      <td style="text-align:center"><span class="inv-stock-val ${stockCls}">${fmtQty(x.stockDisp)}</span><div style="font-size:.65rem;color:var(--gray)">${escHtml(x.primaryUnit)}</div></td>
    </tr>`;
  }).join('');
}

function sortInvProd(mode){
  _invProdSort=mode;
  document.getElementById('inv-prod-sort-stock').classList.toggle('active',mode==='stock');
  document.getElementById('inv-prod-sort-az').classList.toggle('active',mode==='az');
  _renderInvProd();
}

async function saveInvFromPanel(btn){
  const inner=btn.closest('[data-rowtype]');
  const tipo=inner.dataset.rowtype;const idx=parseInt(inner.dataset.rowidx);
  const inputs=inner.querySelectorAll('input[type="number"]');
  let si=parseFloat(inputs[0]?.value)||0;
  let aj=parseFloat(inputs[1]?.value)||0;
  let mn=tipo==='ins'?(parseFloat(inputs[2]?.value)||0):undefined;
  let key,n;
  if(tipo==='ins'){n=cats.insumos[idx];key='ins_'+n;}
  else{const all=[...cats.panes,...cats.pasteles];n=all[idx];key='prod_'+n;}
  if(!n){toast('❌ Error identificando ítem','var(--red)');return}
  // Convertir de unidades prácticas a unidad base para almacenamiento
  if(tipo==='ins'){const pp=getPrimaryPractical('insumos',n);si=Math.round(si*pp.factor*1000)/1000;aj=Math.round(aj*pp.factor*1000)/1000;mn=Math.round((mn||0)*pp.factor*1000)/1000;}
  else if(tipo==='prod'){const catKey=cats.panes.includes(n)?'panes':'pasteles';const pp=getPrimaryPractical(catKey,n);si=Math.round(si*pp.factor*1000)/1000;aj=Math.round(aj*pp.factor*1000)/1000;}
  const rows=await dbAll('inventario');const ex=rows.find(r=>r.key===key);
  const data=tipo==='ins'?{key,si,aj,min:mn}:{key,si,aj};
  const merged={...(ex||{}),key,...data};
  try{if(ex)await dbPut('inventario',merged);else await dbAdd('inventario',merged);}
  catch(e){if(!e?.queued){toast('❌ '+(e?.message||'No se pudo guardar'),'var(--red)');return}}
  toast('✅ Stock guardado');
  await renderInv();
}

// Mantener compatibilidad con llamadas anteriores a saveInvFromRow
async function saveInvFromRow(btn){ return saveInvFromPanel(btn); }

// ════════════════════════════════════════════
// MODAL EDICIÓN
// ════════════════════════════════════════════
const UND_PROD=['unidad','plancha','pastel entero','docena','bandeja','caja','paquete','lata','jaba','kilogramo'];
function unitOptionsForRecord(store,rec){
  if(store==='entradas'||store==='salidas_ins')return getCatalogUnits('insumos',rec.insumo);
  if(store==='produccion')return getCatalogUnits(rec.tipo==='pastel'?'pasteles':'panes',rec.producto);
  if(store==='salida_prod')return getCatalogUnits(rec.categoria==='Pasteles'?'pasteles':'panes',rec.producto);
  return [];
}
const FIELDS={
  entradas:[{k:'fecha',l:'Fecha',t:'date'},{k:'tipodoc',l:'Tipo Doc.',t:'sel',opts:['Boleta','Factura','Otro']},{k:'numdoc',l:'N° Documento',t:'text'},{k:'insumo',l:'Insumo',t:'selCat',cat:'insumos'},{k:'unidad',l:'Unidad práctica',t:'sel',opts:['kilogramo','litro','mililitro','balde','casillero']},{k:'cantidad',l:'Cantidad',t:'num'},{k:'unidadBase',l:'Unidad equivalencia',t:'text'},{k:'factorBase',l:'Equiv. por unidad',t:'num'},{k:'precio',l:'Precio Unit.',t:'num'},{k:'precioTotal',l:'Precio Total',t:'num'},{k:'totalDoc',l:'Total Doc.',t:'num'},{k:'proveedor',l:'Proveedor',t:'text'},{k:'obs',l:'Obs.',t:'text'}],
  salidas_ins:[{k:'fecha',l:'Fecha',t:'date'},{k:'motivo',l:'Motivo',t:'sel',opts:['Usado en Producción','Merma / Pérdida','Devolución','Otro']},{k:'ticket',l:'Ticket',t:'text'},{k:'insumo',l:'Insumo',t:'selCat',cat:'insumos'},{k:'unidad',l:'Unidad práctica',t:'sel',opts:['kilogramo','litro','mililitro','balde','casillero']},{k:'cantidad',l:'Cantidad',t:'num'},{k:'unidadBase',l:'Unidad equivalencia',t:'text'},{k:'factorBase',l:'Equiv. por unidad',t:'num'},{k:'obs',l:'Obs.',t:'text'}],
  produccion:[{k:'fecha',l:'Fecha',t:'date'},{k:'turno',l:'Turno',t:'sel',opts:['Mañana','Tarde','Noche']},{k:'producto',l:'Producto',t:'text'},{k:'unidad',l:'Unidad práctica',t:'sel',opts:UND_PROD},{k:'cantidadPresentacion',l:'Cant. práctica',t:'num'},{k:'unidadTeorica',l:'Unidad teórica',t:'text'},{k:'eqA',l:'Cant. teórica total',t:'num'},{k:'unidadSub',l:'Sub unidad',t:'text'},{k:'cantidad',l:'Cant. sub unidad total',t:'num'},{k:'defectuosa',l:'Cant. Defectuosa',t:'num'},{k:'obs',l:'Obs.',t:'text'}],
  salida_prod:[{k:'fecha',l:'Fecha',t:'date'},{k:'categoria',l:'Categoría',t:'sel',opts:['Panes','Pasteles']},{k:'producto',l:'Producto',t:'text'},{k:'unidad',l:'Unidad',t:'sel',opts:UND_PROD},{k:'cantidad',l:'Cantidad',t:'num'},{k:'destino',l:'Destino',t:'text'},{k:'documento',l:'N° Doc.',t:'text'},{k:'obs',l:'Obs.',t:'text'}]
};
async function openEdit(store,id){
  const rows=await dbAll(store);const rec=rows.find(r=>r.id===id);if(!rec)return;
  editCtx={store,id,rec};
  const panEditFields=[
    {k:'fecha',l:'Fecha',t:'date'},{k:'turno',l:'Turno',t:'sel',opts:['Mañana','Tarde','Noche']},{k:'producto',l:'Producto',t:'text'},
    {k:'cantidad',l:'Unidades',t:'num'},
    {k:'cantidadPresentacion',l:'Latas',t:'num'},
    {k:'porLata',l:'Uni/Lata (x)',t:'num'},
    {k:'eqA',l:'Quintales',t:'num'},
    {k:'defectuosa',l:'Cant. Defectuosa',t:'num'},{k:'obs',l:'Obs.',t:'text'}
  ];
  const pastelEditFields=[
    {k:'fecha',l:'Fecha',t:'date'},{k:'turno',l:'Turno',t:'sel',opts:['Mañana','Tarde','Noche']},{k:'producto',l:'Producto',t:'text'},
    {k:'cantidad',l:'Unidades',t:'num'},
    {k:'defectuosa',l:'Cant. Defectuosa',t:'num'},{k:'obs',l:'Obs.',t:'text'}
  ];
  const fields=store==='produccion'&&rec.tipo==='pan'?panEditFields:(store==='produccion'&&rec.tipo==='pastel'?pastelEditFields:(FIELDS[store]||[]));
  document.getElementById('modal-title').textContent='Editar Registro';
  document.getElementById('modal-fields').innerHTML=fields.map(f=>{
    const fixedPanUnits=store==='produccion'&&rec.tipo==='pan';
    let inp;
    if(fixedPanUnits&&f.k==='unidad')inp=`<input type="text" id="ef-${f.k}" value="lata" readonly>`;
    else if(fixedPanUnits&&f.k==='unidadTeorica')inp=`<input type="text" id="ef-${f.k}" value="quintal" readonly>`;
    else if(fixedPanUnits&&f.k==='unidadSub')inp=`<input type="text" id="ef-${f.k}" value="unidades" readonly>`;
    else if(f.t==='sel'||f.t==='selCat'){const list=f.k==='unidad'?unitOptionsForRecord(store,rec):(f.t==='selCat'?cats[f.cat]:f.opts);const opts=list.map(o=>`<option${o==rec[f.k]?' selected':''}>${o}</option>`).join('');inp=`<select id="ef-${f.k}"><option value="">${rec[f.k]||''}</option>${opts}</select>`;}
    else if(fixedPanUnits&&f.k==='eqA')inp=`<input type="text" id="ef-${f.k}" value="${fmtFractionQty(rec[f.k]||0)}" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ej. 1/2, 2 3/4" onfocus="this.type='text';this.inputMode='text'" onclick="this.type='text';this.inputMode='text'">`;
    else if(f.t==='num')inp=`<input type="number" id="ef-${f.k}" value="${rec[f.k]||0}" min="0" step="0.01">`;
    else if(f.t==='date')inp=`<input type="date" id="ef-${f.k}" value="${rec[f.k]||''}">`;
    else inp=`<input type="text" id="ef-${f.k}" value="${rec[f.k]||''}">`;
    return`<div class="fg">${inp?`<label>${f.l}</label>${inp}`:''}</div>`;
  }).join('');
  document.getElementById('modal-edit').classList.add('open');
}
async function saveEdit(){
  if(!editCtx)return;const{store,id,rec}=editCtx;const fields=FIELDS[store]||[];
  const updated={...rec};
  fields.forEach(f=>{const val=document.getElementById('ef-'+f.k)?.value||'';updated[f.k]=store==='produccion'&&rec.tipo==='pan'&&f.k==='eqA'?parseMixedQty(val):(f.t==='num'?parseFloat(val)||0:val)});
  if(store==='entradas'||store==='salidas_ins'){
    updated.factorBase=updated.factorBase>0?updated.factorBase:getEquivFactor('insumos',updated.insumo,updated.unidad);
    updated.unidadBase=updated.unidadBase||getBaseUnit('insumos',updated.insumo);
    updated.cantidadBase=(updated.cantidad||0)*updated.factorBase;
    updated.equivDetalle=`${fmtQty(updated.factorBase)} ${updated.unidadBase} por ${updated.unidad||'presentación'}`;
  }
  if(store==='salida_prod'){
    const key=updated.categoria==='Pasteles'?'pasteles':'panes';
    updated.factorBase=getEquivFactor(key,updated.producto,updated.unidad);
    updated.unidadBase=getBaseUnit(key,updated.producto);
    updated.cantidadBase=(updated.cantidad||0)*updated.factorBase;
  }
  if(updated.cantidad!==undefined&&updated.defectuosa!==undefined){
    if(store==='produccion'&&updated.tipo==='pan'){
      updated.unidadSub='unidades';
      updated.unidad='lata';
      updated.unidadTeorica='quintal';
    }
    if(store==='produccion'&&updated.tipo==='pastel'){
      updated.unidadSub='unidad';
      updated.unidad='unidad';
      updated.unidadTeorica='unidad';
      updated.cantidadPresentacion=updated.cantidad;
      updated.eqA=updated.cantidad;
    }
    updated.cantidadPresentacion=updated.cantidadPresentacion||updated.cantidad;
    updated.unidadTeorica=updated.unidadTeorica||'lata';
    updated.eqA=updated.eqA||updated.cantidadTeorica||0;
    updated.unidadSub=updated.unidadSub||updated.unidadBase||'unidad';
    updated.eqB=updated.eqA>0?updated.cantidad/updated.eqA:0;
    updated.cantidadTeorica=updated.eqA;
    updated.factorBase=updated.cantidadPresentacion>0?updated.cantidad/updated.cantidadPresentacion:1;
    updated.unidadBase=updated.unidadSub;
    updated.neto=updated.cantidad-updated.defectuosa;
  }
  try{await dbPut(store,updated);}catch(e){if(!e?.queued){toast('❌ '+(e?.message||'No se pudo guardar'),'var(--red)');return}}
  closeModal();toast('✅ Registro actualizado');
  const renders={entradas:renderEntradas,salidas_ins:renderSalidasIns,produccion:renderProd,salida_prod:renderSalidaProd};
  if(renders[store])renders[store]();
}
function closeModal(){document.getElementById('modal-edit').classList.remove('open');editCtx=null}
// Cerrar modal tocando overlay
document.getElementById('modal-edit').addEventListener('click',function(e){if(e.target===this)closeModal()});

// ════════════════════════════════════════════
// ELIMINAR
// ════════════════════════════════════════════
async function del(store,id,cb){
  if(!confirm('¿Eliminar este registro?'))return;
  try{await dbDel(store,id);}catch(e){if(!e?.queued){toast('❌ '+(e?.message||'No se pudo eliminar'),'var(--red)');return}}
  toast('🗑 Eliminado','var(--red)');cb();
}

// ════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════
let _dashPeriodo='dia';
function dashSetPeriodo(p){
  _dashPeriodo=p;
  ['dia','semana','mes'].forEach(x=>{
    const b=document.getElementById('dash-btn-'+x);
    if(b){b.style.border=x===p?'2px solid var(--orange)':'2px solid transparent';b.style.color=x===p?'var(--orange)':'var(--brown)';b.style.fontWeight=x===p?'700':'500';}
  });
  renderDash();
}
function dashIrHoy(){
  document.getElementById('dash-fecha-input').value=hoy();
  dashSetPeriodo('dia');
}
function _dashRango(){
  const base=document.getElementById('dash-fecha-input').value||hoy();
  if(_dashPeriodo==='dia') return{desde:base,hasta:base,lbl:new Date(base+'T12:00:00').toLocaleDateString('es-PE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})};
  const d=new Date(base+'T12:00:00');
  if(_dashPeriodo==='semana'){
    const dow=d.getDay();const lunes=new Date(d);lunes.setDate(d.getDate()-(dow===0?6:dow-1));
    const domingo=new Date(lunes);domingo.setDate(lunes.getDate()+6);
    const fmt2=x=>x.toISOString().split('T')[0];
    return{desde:fmt2(lunes),hasta:fmt2(domingo),lbl:`Semana: ${lunes.toLocaleDateString('es-PE',{day:'numeric',month:'short'})} – ${domingo.toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric'})}`};
  }
  if(_dashPeriodo==='mes'){
    const desde=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const ultimo=new Date(d.getFullYear(),d.getMonth()+1,0);
    const hasta=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(ultimo.getDate()).padStart(2,'0')}`;
    return{desde,hasta,lbl:d.toLocaleDateString('es-PE',{month:'long',year:'numeric'})};
  }
}
function dashAddPractical(map, qty, unit){
  const u=unit||'unidad';
  map[u]=(map[u]||0)+(parseFloat(qty)||0);
}
function dashPracticalText(map){
  return Object.entries(map||{}).map(([u,q])=>`${fmtQtyByUnit(q,u)} ${u}`).join(', ');
}
function dashQtyHtml(practicalMap, baseQty, baseUnit, color){
  const practical=dashPracticalText(practicalMap);
  return `<b style="color:${color}">${practical||`${fmtQty(baseQty)} ${baseUnit||''}`}</b>${baseUnit?`<div style="font-size:.68rem;color:var(--gray)">${fmtQty(baseQty)} ${baseUnit}</div>`:''}`;
}
function dashProdHtml(v,color='var(--green)'){
  const practical=dashPracticalText(v.pr);
  const teor=dashPracticalText(v.teo);
  const sub=dashPracticalText(v.sub)||`${fmtQty(v.neto??v.cant??0)} ${v.unit||'unidad'}`;
  return `<b style="color:${color}">${practical||sub}</b><div style="font-size:.68rem;color:var(--gray)">${[teor,sub].filter(Boolean).join(' - ')}</div>`;
}
function dashProdTipoBadge(tipo){
  return `<span class="badge ${tipo==='pan'?'bpan':'bpast'}">${tipo==='pan'?'Pan':'Pastel'}</span>`;
}
function dashProdUnitText(map,fallback='—'){
  const txt=dashPracticalText(map);
  return txt||fallback;
}
function renderDashProduccion(prodHoy){
  const panesT=document.querySelector('#dash-prod-panes-t tbody');
  const pastelesT=document.querySelector('#dash-prod-pasteles-t tbody');
  const panes=prodHoy.filter(r=>r.tipo==='pan');
  const pasteles=prodHoy.filter(r=>r.tipo==='pastel');
  if(_dashPeriodo!=='dia'){
    const panMap={};
    panes.forEach(r=>{
      if(!panMap[r.producto])panMap[r.producto]={neto:0,pr:{},sub:{}};
      panMap[r.producto].neto+=toNum(r.neto);
      dashAddPractical(panMap[r.producto].pr,r.cantidadPresentacion||0,r.unidad||'lata');
      dashAddPractical(panMap[r.producto].sub,prodCantidadTeorica(r),r.unidadTeorica||'quintal');
    });
    panesT.innerHTML=Object.keys(panMap).length?Object.entries(panMap).map(([p,v])=>`<tr><td>${p}</td><td><b>${fmtQty(v.neto)}</b></td><td>${dashProdUnitText(v.pr)}</td><td>${dashProdUnitText(v.sub)}</td></tr>`).join(''):`<tr><td colspan="4" class="empty">Sin panes</td></tr>`;
    const pastelMap={};
    pasteles.forEach(r=>{if(!pastelMap[r.producto])pastelMap[r.producto]=0;pastelMap[r.producto]+=toNum(r.neto)});
    pastelesT.innerHTML=Object.keys(pastelMap).length?Object.entries(pastelMap).map(([p,neto])=>`<tr><td>${p}</td><td><b>${fmtQty(neto)}</b></td></tr>`).join(''):`<tr><td colspan="2" class="empty">Sin pasteles</td></tr>`;
    return;
  }
  panesT.innerHTML=panes.length?panes.map(r=>{
    const practica=`${fmtQty(r.cantidadPresentacion||0)} ${r.unidad||'lata'}`.trim();
    const unidadTeorica=r.unidadTeorica||'quintal';
    const sub=`${fmtQtyByUnit(prodCantidadTeorica(r),unidadTeorica)} ${unidadTeorica}`.trim();
    return `<tr><td>${r.producto}</td><td><b>${fmtQty(r.neto)}</b></td><td>${practica||'—'}</td><td>${sub||'—'}</td></tr>`;
  }).join(''):`<tr><td colspan="4" class="empty">Sin panes hoy</td></tr>`;
  pastelesT.innerHTML=pasteles.length?pasteles.map(r=>`<tr><td>${r.producto}</td><td><b>${fmtQty(r.neto)}</b></td></tr>`).join(''):`<tr><td colspan="2" class="empty">Sin pasteles hoy</td></tr>`;
}
async function renderDash(){
  if(!document.getElementById('dash-fecha-input').value) document.getElementById('dash-fecha-input').value=hoy();
  const{desde,hasta,lbl}=_dashRango();
  const inRango=fecha=>fecha>=desde&&fecha<=hasta;
  const[ent,salI,prod,sp,invR]=await Promise.all([dbAll('entradas'),dbAll('salidas_ins'),dbAll('produccion'),dbAll('salida_prod'),dbAll('inventario')]);
  const entHoy=ent.filter(r=>inRango(r.fecha));const salIHoy=salI.filter(r=>inRango(r.fecha));
  const prodHoy=prod.filter(r=>inRango(r.fecha));const spHoy=sp.filter(r=>inRango(r.fecha));
  // Título y etiqueta de período
  const periodoNombre=_dashPeriodo==='dia'?'Resumen del Día':_dashPeriodo==='semana'?'Resumen Semanal':'Resumen Mensual';
  document.getElementById('dash-ptitle').textContent='📊 '+periodoNombre;
  document.getElementById('dash-fecha').textContent=lbl.charAt(0).toUpperCase()+lbl.slice(1);
  ['dash-lbl-periodo','dash-lbl-periodo2','dash-lbl-periodo3','dash-lbl-periodo4'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=_dashPeriodo==='dia'?'Hoy':_dashPeriodo==='semana'?'Esta Semana':'Este Mes'});
  document.getElementById('sgrid').innerHTML=`
    <div class="scard"><div class="slbl">Insumos Ingresados</div><div class="sval">${entHoy.reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0)}</div><div class="ssub">${entHoy.length} línea(s)</div></div>
    <div class="scard gd"><div class="slbl">Insumos Usados</div><div class="sval">${salIHoy.reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0)}</div><div class="ssub">${salIHoy.length} línea(s)</div></div>
    <div class="scard g"><div class="slbl">Panes Netos</div><div class="sval">${fmtQty(prodHoy.filter(r=>r.tipo==='pan').reduce((s,r)=>s+toNum(r.neto),0))}</div><div class="ssub">${prodHoy.filter(r=>r.tipo==='pan').length} lote(s)</div></div>
    <div class="scard gd"><div class="slbl">Pasteles Netos</div><div class="sval">${fmtQty(prodHoy.filter(r=>r.tipo==='pastel').reduce((s,r)=>s+toNum(r.neto),0))}</div><div class="ssub">${prodHoy.filter(r=>r.tipo==='pastel').length} lote(s)</div></div>`;
  const insMap={};
  entHoy.forEach(r=>{if(!insMap[r.insumo])insMap[r.insumo]={e:0,s:0,eu:getBaseUnit('insumos',r.insumo),ep:{},sp:{}};insMap[r.insumo].e+=baseQtyForRecord(r,'insumos','insumo');insMap[r.insumo].eu=r.unidadBase||insMap[r.insumo].eu;dashAddPractical(insMap[r.insumo].ep,r.cantidad,r.unidad)});
  salIHoy.forEach(r=>{if(!insMap[r.insumo])insMap[r.insumo]={e:0,s:0,eu:getBaseUnit('insumos',r.insumo),ep:{},sp:{}};insMap[r.insumo].s+=baseQtyForRecord(r,'insumos','insumo');insMap[r.insumo].eu=r.unidadBase||insMap[r.insumo].eu;dashAddPractical(insMap[r.insumo].sp,r.cantidad,r.unidad)});
  const t1=document.querySelector('#dash-ins-t tbody');const insKeys=Object.keys(insMap);
  t1.innerHTML=insKeys.length?insKeys.map(n=>`<tr><td><b>${n}</b></td><td>${dashQtyHtml(insMap[n].ep,insMap[n].e,insMap[n].eu,'var(--green)')}</td><td>${dashQtyHtml(insMap[n].sp,insMap[n].s,insMap[n].eu,'var(--red)')}</td></tr>`).join(''):`<tr><td colspan="3" class="empty">Sin movimientos</td></tr>`;
  renderDashProduccion(prodHoy);
  // Producción agrupada por producto en semana/mes
  if(_dashPeriodo!=='dia'){
    const salMap={};spHoy.forEach(r=>{if(!salMap[r.producto])salMap[r.producto]={cant:0,unit:r.unidadBase||getBaseUnit(r.categoria==='Pasteles'?'pasteles':'panes',r.producto),pr:{}};salMap[r.producto].cant+=prodOutBaseQty(r);dashAddPractical(salMap[r.producto].pr,r.cantidad,r.unidad)});
    document.querySelector('#dash-sal-t tbody').innerHTML=Object.keys(salMap).length?Object.entries(salMap).map(([p,v])=>`<tr><td>${p}</td><td>${dashQtyHtml(v.pr,v.cant,v.unit,'var(--red)')}</td><td>—</td></tr>`).join(''):`<tr><td colspan="3" class="empty">Sin salidas</td></tr>`;
  }else{
    document.querySelector('#dash-sal-t tbody').innerHTML=spHoy.length?spHoy.map(r=>`<tr><td>${r.producto}</td><td>${dashQtyHtml(Object.fromEntries([[r.unidad||'unidad',r.cantidad]]),prodOutBaseQty(r),r.unidadBase||getBaseUnit(r.categoria==='Pasteles'?'pasteles':'panes',r.producto),'var(--red)')}</td><td>${r.destino||'—'}</td></tr>`).join(''):`<tr><td colspan="3" class="empty">Sin salidas hoy</td></tr>`;
  }
  const getInvL=key=>{const r=invR.find(r=>r.key===key);return r||{si:0,aj:0,min:0}};
  const criticos=cats.insumos.map(n=>{
    const e=ent.filter(r=>r.insumo===n).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);
    const s=salI.filter(r=>r.insumo===n).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);
    const inv=getInvL('ins_'+n);const stock=(inv.si||0)+e-s+(inv.aj||0);const min=inv.min||0;return{n,stock,min};
  }).filter(x=>x.min>0&&x.stock<=x.min);
  document.querySelector('#dash-crit-t tbody').innerHTML=criticos.length?criticos.map(x=>`<tr style="background:#FFF0F0"><td><b>${x.n}</b></td><td class="stock-red">${x.stock}</td><td>${x.min}</td></tr>`).join(''):`<tr><td colspan="3" style="text-align:center;color:var(--green);padding:14px">✅ Todo sobre el mínimo</td></tr>`;
}

// ════════════════════════════════════════════
// EXPORTAR / IMPORTAR
// ════════════════════════════════════════════
async function exportarExcel(){
  const[ent,salI,prod,sp,invR]=await Promise.all([dbAll('entradas'),dbAll('salidas_ins'),dbAll('produccion'),dbAll('salida_prod'),dbAll('inventario')]);
  const wb=XLSX.utils.book_new();const today=hoy();
  const mkSheet=(data,cols)=>{const rows=[cols.map(c=>c.label),...data.map(r=>cols.map(c=>r[c.key]??''))];return XLSX.utils.aoa_to_sheet(rows)};
  XLSX.utils.book_append_sheet(wb,mkSheet(ent,[{key:'fecha',label:'Fecha'},{key:'tipodoc',label:'Tipo Doc.'},{key:'numdoc',label:'N° Doc.'},{key:'insumo',label:'Insumo'},{key:'unidad',label:'Unidad'},{key:'cantidad',label:'Cantidad'},{key:'precio',label:'Precio Unit.'},{key:'precioTotal',label:'Precio Total'},{key:'totalDoc',label:'Total Doc.'},{key:'proveedor',label:'Proveedor'},{key:'obs',label:'Obs.'}]),'Entradas de Insumos');
  XLSX.utils.book_append_sheet(wb,mkSheet(salI,[{key:'fecha',label:'Fecha'},{key:'motivo',label:'Motivo'},{key:'ticket',label:'Ticket'},{key:'insumo',label:'Insumo'},{key:'unidad',label:'Unidad'},{key:'cantidad',label:'Cantidad'},{key:'obs',label:'Obs.'}]),'Salidas de Insumos');
  XLSX.utils.book_append_sheet(wb,mkSheet(prod,[{key:'fecha',label:'Fecha'},{key:'tipo',label:'Categoría'},{key:'turno',label:'Turno'},{key:'producto',label:'Producto'},{key:'unidad',label:'Unidad'},{key:'cantidad',label:'Producido'},{key:'defectuosa',label:'Defectuoso'},{key:'neto',label:'Neto'},{key:'obs',label:'Obs.'}]),'Producción');
  XLSX.utils.book_append_sheet(wb,mkSheet(sp,[{key:'fecha',label:'Fecha'},{key:'categoria',label:'Categoría'},{key:'producto',label:'Producto'},{key:'unidad',label:'Unidad'},{key:'cantidad',label:'Cantidad'},{key:'destino',label:'Destino'},{key:'encargado',label:'Encargado'},{key:'documento',label:'N° Doc.'},{key:'obs',label:'Obs.'}]),'Salida de Productos');
  const getInv=key=>{const r=invR.find(r=>r.key===key);return r||{si:0,aj:0,min:0}};
  const invData=cats.insumos.map(n=>{const e=ent.filter(r=>r.insumo===n).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);const s=salI.filter(r=>r.insumo===n).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);const inv=getInv('ins_'+n);const stock=(inv.si||0)+e-s+(inv.aj||0);return{insumo:n,entradas:e,salidas:s,stock_inicial:inv.si||0,ajuste:inv.aj||0,stock_actual:stock,minimo:inv.min||0,estado:stock<=(inv.min||0)&&(inv.min||0)>0?'⚠ Bajo mínimo':'OK'}});
  XLSX.utils.book_append_sheet(wb,mkSheet(invData,[{key:'insumo',label:'Insumo'},{key:'entradas',label:'Entradas'},{key:'salidas',label:'Salidas'},{key:'stock_inicial',label:'Stk. Inicial'},{key:'ajuste',label:'Ajuste'},{key:'stock_actual',label:'Stock Actual'},{key:'minimo',label:'Stock Mínimo'},{key:'estado',label:'Estado'}]),'Inventario Insumos');
  XLSX.writeFile(wb,`PanControl_Reporte_${today}.xlsx`);toast('📊 Reporte exportado');
}
async function exportarDatos(){
  const[ent,salI,prod,sp,invR,cats_r]=await Promise.all([dbAll('entradas'),dbAll('salidas_ins'),dbAll('produccion'),dbAll('salida_prod'),dbAll('inventario'),dbAll('catalogos')]);
  const blob=new Blob([JSON.stringify({version:2,fecha_exportacion:new Date().toISOString(),entradas:ent,salidas_ins:salI,produccion:prod,salida_prod:sp,inventario:invR,catalogos:cats_r},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`PanControl_Backup_${hoy()}.json`;a.click();URL.revokeObjectURL(a.href);toast('✅ Datos exportados');
}
async function importarDatos(input){
  const file=input.files[0];if(!file)return;
  const status=document.getElementById('import-status');
  status.style.display='block';status.style.color='var(--gold)';status.textContent='⏳ Importando datos...';
  try{
    const backup=JSON.parse(await file.text());
    if(!backup.version||!backup.entradas){status.style.color='var(--red)';status.textContent='❌ Archivo inválido';return}
    if(!confirm(`¿Importar respaldo del ${backup.fecha_exportacion?.split('T')[0]}?\nEntradas: ${backup.entradas?.length||0}, Producción: ${backup.produccion?.length||0}`)){status.style.display='none';input.value='';return}
    let total=0;
    for(const[store,rows] of [['entradas',backup.entradas],['salidas_ins',backup.salidas_ins],['produccion',backup.produccion],['salida_prod',backup.salida_prod],['inventario',backup.inventario]]){
      if(!rows?.length)continue;const existing=await dbAll(store);const existingIds=new Set(existing.map(r=>r.id));
      for(const row of rows){const{id,...rest}=row;if(!existingIds.has(id)){await dbAdd(store,rest);total++;}}
    }
    if(backup.catalogos?.length){const catRows=await dbAll('catalogos');if(!catRows.length){const{id,...catData}=backup.catalogos[backup.catalogos.length-1];await dbAdd('catalogos',catData);await loadCats();}}
    status.style.color='var(--green)';status.textContent=`✅ ${total} registro(s) importados`;
    renderDash();renderEntradas();renderSalidasIns();renderProd();
  }catch(e){status.style.color='var(--red)';status.textContent='❌ Error: '+e.message}
  input.value='';
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
// Reportes admin: reemplaza las funciones anteriores sin tocar el resto de modulos.
function isViewerMode(){return document.body.classList.contains('viewer-mode')||currentRole==='viewer'}
function requireAdminExport(){
  if(isViewerMode()){toast('⚠ Solo el administrador puede descargar o cargar archivos','var(--red)');return false}
  return true;
}
function rangoReporte(){
  let desde=document.getElementById('rep-desde')?.value||document.getElementById('dash-fecha-input')?.value||hoy();
  let hasta=document.getElementById('rep-hasta')?.value||desde;
  if(desde>hasta){const tmp=desde;desde=hasta;hasta=tmp}
  return{desde,hasta,etiqueta:desde===hasta?desde:`${desde} a ${hasta}`};
}
function addWorkbookSheet(wb,name,rows,widths=[]){
  const ws=XLSX.utils.aoa_to_sheet(rows);
  const maxCols=rows.reduce((m,r)=>Math.max(m,r.length),0);
  ws['!cols']=(widths.length?widths:Array.from({length:maxCols},()=>18)).map(w=>({wch:w}));
  if(rows.length>1&&maxCols>0)ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:maxCols-1}})};
  XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));
}
function groupSum(rows,keyFn,valFn){
  const map={};
  rows.forEach(r=>{const key=keyFn(r)||'Sin dato';map[key]=(map[key]||0)+(Number(valFn(r))||0)});
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}
function dateList(desde,hasta){
  const out=[];const d=new Date(desde+'T12:00:00');const end=new Date(hasta+'T12:00:00');
  while(d<=end){out.push(d.toISOString().split('T')[0]);d.setDate(d.getDate()+1)}
  return out;
}
function dailyRows(dates,ent,salI,prod){
  return dates.map(fecha=>[
    fecha,
    ent.filter(r=>r.fecha===fecha).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0),
    salI.filter(r=>r.fecha===fecha).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0),
    prod.filter(r=>r.fecha===fecha&&r.tipo==='pan').reduce((s,r)=>s+toNum(r.neto),0),
    prod.filter(r=>r.fecha===fecha&&r.tipo==='pastel').reduce((s,r)=>s+toNum(r.neto),0)
  ]);
}
async function exportarExcel(){
  if(!requireAdminExport())return;
  const{desde,hasta,etiqueta}=rangoReporte();
  const inRango=r=>r.fecha>=desde&&r.fecha<=hasta;
  const[entAll,salIAll,prodAll,spAll,invR]=await Promise.all([dbAll('entradas'),dbAll('salidas_ins'),dbAll('produccion'),dbAll('salida_prod'),dbAll('inventario')]);
  const ent=entAll.filter(inRango),salI=salIAll.filter(inRango),prod=prodAll.filter(inRango);
  const wb=XLSX.utils.book_new();
  wb.Props={Title:'Reporte PanControl',Subject:`Reporte ${etiqueta}`,Author:'PanControl',CreatedDate:new Date()};
  const insIngresados=ent.reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);
  const insUsados=salI.reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);
  const panesNetos=prod.filter(r=>r.tipo==='pan').reduce((s,r)=>s+toNum(r.neto),0);
  const pastelesNetos=prod.filter(r=>r.tipo==='pastel').reduce((s,r)=>s+toNum(r.neto),0);
  const topIng=groupSum(ent,r=>r.insumo,r=>baseQtyForRecord(r,'insumos','insumo'));
  const topUso=groupSum(salI,r=>r.insumo,r=>baseQtyForRecord(r,'insumos','insumo'));
  const prodTop=groupSum(prod,r=>`${r.producto}||${r.tipo}`,r=>toNum(r.neto));
  addWorkbookSheet(wb,'Dashboard',[
    ['PanControl - Dashboard de Reporte'],
    ['Periodo',etiqueta,'Generado',new Date().toLocaleString('es-PE')],
    [],
    ['Indicador','Valor','Detalle'],
    ['Insumos ingresados',insIngresados,`${ent.length} linea(s)`],
    ['Insumos usados',insUsados,`${salI.length} linea(s)`],
    ['Panes netos',panesNetos,`${prod.filter(r=>r.tipo==='pan').length} lote(s)`],
    ['Pasteles netos',pastelesNetos,`${prod.filter(r=>r.tipo==='pastel').length} lote(s)`],
    [],
    ['Top insumos ingresados','','Top insumos usados',''],
    ['Insumo','Cantidad','Insumo','Cantidad'],
    ...Array.from({length:10},(_,i)=>[topIng[i]?.[0]||'',topIng[i]?.[1]||0,topUso[i]?.[0]||'',topUso[i]?.[1]||0]),
    [],
    ['Produccion por producto'],
    ['Producto','Tipo','Neto'],
    ...prodTop.slice(0,20).map(([k,v])=>{const[p,t]=k.split('||');return[p,t,v]})
  ],[30,16,30,16]);
  addWorkbookSheet(wb,'Resumen Diario',[['Fecha','Insumos ingresados','Insumos usados','Panes netos','Pasteles netos'],...dailyRows(dateList(desde,hasta),ent,salI,prod)],[14,18,16,14,14]);
  const mkRows=(data,cols)=>[cols.map(c=>c.label),...data.map(r=>cols.map(c=>typeof c.val==='function'?c.val(r):(r[c.key]??'')))];
  addWorkbookSheet(wb,'Entradas Insumos',mkRows(ent,[{key:'fecha',label:'Fecha'},{key:'tipodoc',label:'Tipo Doc.'},{key:'numdoc',label:'N° Doc.'},{key:'insumo',label:'Insumo'},{key:'unidad',label:'Unidad'},{key:'cantidad',label:'Cantidad'},{key:'precio',label:'Precio Unit.'},{key:'precioTotal',label:'Precio Total'},{key:'totalDoc',label:'Total Doc.'},{key:'proveedor',label:'Proveedor'},{key:'obs',label:'Obs.'}]),[12,12,14,28,12,12,14,14,14,22,24]);
  addWorkbookSheet(wb,'Salidas Insumos',mkRows(salI,[{key:'fecha',label:'Fecha'},{key:'motivo',label:'Motivo'},{key:'ticket',label:'Ticket'},{key:'insumo',label:'Insumo'},{key:'unidad',label:'Unidad'},{key:'cantidad',label:'Cantidad'},{key:'obs',label:'Obs.'}]),[12,20,14,28,12,12,24]);
  addWorkbookSheet(wb,'Produccion',mkRows(prod,[{key:'fecha',label:'Fecha'},{key:'tipo',label:'Categoria'},{key:'turno',label:'Turno'},{key:'producto',label:'Producto'},{key:'unidad',label:'Unidad practica'},{key:'cantidad',label:'Producido'},{key:'defectuosa',label:'Defectuoso'},{key:'neto',label:'Neto'},{key:'obs',label:'Obs.'}]),[12,12,12,28,16,12,12,12,24]);
  const getInv=key=>{const r=invR.find(r=>r.key===key);return r||{si:0,aj:0,min:0}};
  const invData=cats.insumos.map(n=>{
    const e=entAll.filter(r=>r.insumo===n).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);
    const s=salIAll.filter(r=>r.insumo===n).reduce((s,r)=>s+baseQtyForRecord(r,'insumos','insumo'),0);
    const inv=getInv('ins_'+n);const stock=(inv.si||0)+e-s+(inv.aj||0);
    return[n,e,s,inv.si||0,inv.aj||0,stock,inv.min||0,stock<=(inv.min||0)&&(inv.min||0)>0?'Bajo minimo':'OK'];
  });
  addWorkbookSheet(wb,'Inventario Insumos',[['Insumo','Entradas historicas','Salidas historicas','Stock inicial','Ajuste','Stock actual','Stock minimo','Estado'],...invData],[28,18,18,14,12,14,14,14]);
  XLSX.writeFile(wb,`PanControl_Reporte_${desde}_${hasta}.xlsx`);
  toast(`📊 Reporte exportado: ${etiqueta}`);
}
async function exportarDatos(){
  if(!requireAdminExport())return;
  const[ent,salI,prod,sp,invR,cats_r]=await Promise.all([dbAll('entradas'),dbAll('salidas_ins'),dbAll('produccion'),dbAll('salida_prod'),dbAll('inventario'),dbAll('catalogos')]);
  const blob=new Blob([JSON.stringify({version:2,fecha_exportacion:new Date().toISOString(),entradas:ent,salidas_ins:salI,produccion:prod,salida_prod:sp,inventario:invR,catalogos:cats_r},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`PanControl_Backup_${hoy()}.json`;a.click();URL.revokeObjectURL(a.href);toast('✅ Datos exportados');
}
async function importarDatos(input){
  if(!requireAdminExport()){input.value='';return}
  const file=input.files[0];if(!file)return;
  const status=document.getElementById('import-status');
  status.style.display='block';status.style.color='var(--gold)';status.textContent='⏳ Importando datos...';
  try{
    const backup=JSON.parse(await file.text());
    if(!backup.version||!backup.entradas){status.style.color='var(--red)';status.textContent='❌ Archivo inválido';return}
    if(!confirm(`¿Importar respaldo del ${backup.fecha_exportacion?.split('T')[0]}?\nEntradas: ${backup.entradas?.length||0}, Producción: ${backup.produccion?.length||0}`)){status.style.display='none';input.value='';return}
    let total=0;
    for(const[store,rows] of [['entradas',backup.entradas],['salidas_ins',backup.salidas_ins],['produccion',backup.produccion],['salida_prod',backup.salida_prod],['inventario',backup.inventario]]){
      if(!rows?.length)continue;const existing=await dbAll(store);const existingIds=new Set(existing.map(r=>r.id));
      for(const row of rows){const{id,...rest}=row;if(!existingIds.has(id)){await dbAdd(store,rest);total++;}}
    }
    if(backup.catalogos?.length){const catRows=await dbAll('catalogos');if(!catRows.length){const{id,...catData}=backup.catalogos[backup.catalogos.length-1];await dbAdd('catalogos',catData);await loadCats();}}
    status.style.color='var(--green)';status.textContent=`✅ ${total} registro(s) importados`;
    renderDash();renderEntradas();renderSalidasIns();renderProd();
  }catch(e){status.style.color='var(--red)';status.textContent='❌ Error: '+e.message}
  input.value='';
}

async function init(){
  await loadCats();
  setHoy('ent-fecha','sal-ins-fecha','pp-fecha','pa-fecha','sp-fecha');
  initOCRConfig();
  renderDash();renderEntradas();renderSalidasIns();renderProd();
  const dateStr=new Date().toLocaleDateString('es-PE',{timeZone:'America/Lima',day:'2-digit',month:'short',year:'numeric'});
  const sdDate=document.getElementById('sd-date');if(sdDate)sdDate.textContent=dateStr;
  addLineaEntrada();addLineaSalidaIns();
  updateConnUI();
  window.addEventListener('online',()=>{updateConnUI();flushPending()});
  window.addEventListener('offline',updateConnUI);
}

// ════════════════════════════════════════════
// PWA — SERVICE WORKER + BOTÓN INSTALAR
// ════════════════════════════════════════════
let deferredPrompt = null;

// Registrar Service Worker
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js?v=20260527-reportes-admin')
      .then(reg => console.log('SW registrado:', reg.scope))
      .catch(err => console.log('SW error:', err));
  });
}

// Capturar evento de instalación (Android/Chrome)
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('install-btn');
  if(btn) btn.style.display = 'flex';
});

// Cuando ya está instalada, ocultar botón
window.addEventListener('appinstalled', ()=>{
  deferredPrompt = null;
  const btn = document.getElementById('install-btn');
  if(btn) btn.style.display = 'none';
  toast('✅ App instalada en tu pantalla de inicio');
});

async function instalarApp(){
  if(deferredPrompt){
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    const btn = document.getElementById('install-btn');
    if(btn) btn.style.display = 'none';
  } else {
    // iOS: mostrar instrucciones
    document.getElementById('ios-modal').classList.add('open');
  }
}
function cerrarIosModal(){
  document.getElementById('ios-modal').classList.remove('open');
}
// Detectar si es iOS para mostrar instrucciones manuales
function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
window.addEventListener('load', ()=>{
  const btn = document.getElementById('install-btn');
  if(!btn) return;
  // En iOS no hay beforeinstallprompt — mostrar botón siempre si no está en standalone
  if(isIOS() && window.navigator.standalone !== true){
    btn.style.display = 'flex';
  }
  // Si ya está corriendo como app instalada, ocultar
  if(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone){
    btn.style.display = 'none';
  }
});

(function(){
  const widget=document.getElementById('doraemon-widget');
  const video=document.getElementById('doraemon-video');
  let dragging=false,moved=false;
  let startX=0,startY=0,origLeft=0,origTop=0;
  let storedLeft=null,storedTop=null;

  function startDrag(cx,cy){
    if(widget.classList.contains('excited'))return;
    dragging=true;moved=false;
    if(storedLeft!==null){
      origLeft=storedLeft;origTop=storedTop;
    } else {
      const r=widget.getBoundingClientRect();
      origLeft=r.left;origTop=r.top;
      storedLeft=origLeft;storedTop=origTop;
    }
    startX=cx;startY=cy;
    widget.style.right='auto';widget.style.bottom='auto';
    widget.style.left=origLeft+'px';widget.style.top=origTop+'px';
    widget.style.cursor='grabbing';
  }

  function onMove(cx,cy){
    if(!dragging)return;
    const dx=cx-startX,dy=cy-startY;
    if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;
    if(moved){
      let nl=origLeft+dx,nt=origTop+dy;
      nl=Math.max(0,Math.min(window.innerWidth-widget.offsetWidth,nl));
      nt=Math.max(0,Math.min(window.innerHeight-widget.offsetHeight,nt));
      storedLeft=nl;storedTop=nt;
      widget.style.left=nl+'px';widget.style.top=nt+'px';
    }
  }

  function endDrag(){
    if(!dragging)return;
    dragging=false;
    widget.style.cursor='grab';
    if(!moved){
      if(widget.classList.contains('excited'))return;
      const r=widget.getBoundingClientRect();
      const originH=(window.innerWidth-r.right)>=r.left?'left':'right';
      const originV=(window.innerHeight-r.bottom)>=r.top?'top':'bottom';
      widget.style.transformOrigin=originH+' '+originV;
      video.currentTime=0;
      video.play().catch(()=>{});
      widget.classList.add('excited');
    }
  }

  // Al terminar la animación, volver al primer frame
  video.addEventListener('ended',()=>{video.currentTime=0;video.pause();});
  widget.addEventListener('animationend',()=>{widget.classList.remove('excited');widget.style.transformOrigin='';});

  // Mouse
  widget.addEventListener('mousedown',e=>{e.preventDefault();startDrag(e.clientX,e.clientY);});
  document.addEventListener('mousemove',e=>{onMove(e.clientX,e.clientY);});
  document.addEventListener('mouseup',()=>{endDrag();});

  // Touch
  widget.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];startDrag(t.clientX,t.clientY);},{passive:false});
  document.addEventListener('touchmove',e=>{if(dragging){e.preventDefault();const t=e.touches[0];onMove(t.clientX,t.clientY);}},{passive:false});
  document.addEventListener('touchend',()=>{endDrag();});
})();
