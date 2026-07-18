# Pan Control — Módulo "Producción y estandarización"

Documentación técnica del módulo agregado. Objetivo: convertir el conocimiento
práctico de los maestros panaderos y pasteleros (como María) en procesos
medibles, repetibles, controlables y fáciles de enseñar, sin reemplazar su
criterio.

---

## 1. Arquitectura encontrada

| Aspecto | Detalle |
|---|---|
| Tipo | PWA de JavaScript puro (sin framework, sin build, sin package.json) |
| UI | `index.html` (páginas `.page`, tabs `.tc`, sidebar + bottom-nav), `style.css` |
| Lógica | `app.js` (~1 900 líneas, funciones globales, español compacto) |
| Persistencia | IndexedDB local `PanControl2` + sincronización opcional a Firebase Firestore (lista fija de stores) |
| Autenticación | Contraseña → SHA-256 → rol `admin` o `viewer` (100 % en cliente, `sessionStorage`) |
| Backend | Solo un Cloudflare Worker para OCR de facturas (`backend-cloudflare-worker/`) |
| Pruebas previas | Ninguna |
| Migraciones | `onupgradeneeded` de IndexedDB (creación idempotente de stores) |

## 2. Decisiones tomadas (y por qué)

1. **Sin frameworks ni dependencias nuevas.** Se respeta la arquitectura
   vanilla JS existente (restricción 19: no instalar tecnologías por
   preferencia personal).
2. **Lógica de dominio separada de la UI.** `produccion-core.js` es un módulo
   puro (sin DOM, sin IndexedDB) con exportación UMD: funciona en el navegador
   (`window.EstCore`) y en Node (para pruebas y para reutilizarlo en otro
   proyecto web — requisito de portabilidad, sección 17).
3. **Los stores `est_*` NO se sincronizan con Firestore en esta fase.** El
   sync existente hace espejo con borrado (elimina registros locales ausentes
   en la nube); conectar stores nuevos sin preparar la nube podría borrar
   datos. Decisión conservadora documentada; el módulo incluye su propio
   respaldo/restauración JSON. Integrarlo al sync queda como fase futura.
4. **Unidades base internas fijas:** masa → gramos, volumen → mililitros,
   conteo → unidades. Conversiones físicas (kg, L, docena) están cableadas;
   las **presentaciones comerciales (saco, lata, paquete) son 100 %
   configurables por ingrediente** con su propia equivalencia (un saco del
   proveedor A puede ser 50 kg y el del proveedor B 40 kg).
5. **Precisión numérica:** JavaScript solo dispone de `Number` (float64). Se
   mitiga trabajando en unidades base (enteros o casi enteros, exactos hasta
   2^53), **sin redondear durante los cálculos**; el redondeo ocurre solo al
   mostrar (`redondear`/`fmtCantidad`, documentados en el core).
6. **Inmutabilidad histórica por snapshot.** Al crear una orden se congela una
   copia profunda de la versión de receta (`snapshotVersion`). Cambios
   posteriores de la receta no alteran órdenes ni lotes históricos (verificado
   por prueba).
7. **Recetas aprobadas no editables.** Máquina de estados
   `borrador → en_prueba → aprobada → reemplazada/archivada` con transiciones
   validadas en el core. Para cambiar una receta aprobada se crea una nueva
   versión; al aprobar una versión, la aprobada anterior pasa a `reemplazada`.
8. **Permisos en la capa de datos, no solo en botones.** Toda función de
   mutación llama a `estGuard(accion)` (matriz `EstCore.PERMISOS`). Con el
   login actual: `admin` → acceso completo, `viewer` → solo lectura. Los roles
   `tecnico` (maestra pastelera), `maestro` y `calidad` ya están definidos en
   la matriz para cuando se agreguen credenciales propias en `ROLES` de
   `app.js`. **Limitación honesta:** al no existir backend de datos, ninguna
   validación de cliente es una barrera de seguridad real; es la mejor
   aproximación posible en esta arquitectura.
9. **Nombre neutro y desacoplado.** Nada del módulo referencia marcas ni
   empresas; el sistema sigue llamándose Pan Control.

## 3. Archivos creados

| Archivo | Contenido |
|---|---|
| `produccion-core.js` | Dominio puro: unidades/conversiones, porcentaje panadero, estados y transiciones, validación de versiones, detección de ciclos de subrecetas, expansión BOM multinivel con mermas, calculadora A/B/C, fórmulas (rendimiento, merma, peso utilizable, unidades esperadas, cumplimiento), estadísticas de muestras de peso, validación del registro real, KPIs, snapshot, matriz de permisos |
| `produccion-ui.js` | Interfaz del módulo: Panel, Ingredientes, Productos, Recetas/Versiones/Pasos, Calculadora, Órdenes/Lotes/Calidad, auditoría, impresión, respaldo e importación, datos demo |
| `tests/produccion-core.test.js` | 58 pruebas del dominio (Node, sin dependencias) |
| `PRODUCCION_ESTANDARIZACION.md` | Este documento |

## 4. Archivos modificados

| Archivo | Cambio |
|---|---|
| `app.js` | `VER` de IndexedDB 2→3 y stores `est_*` agregados a `onupgradeneeded` (solo crea, nunca borra); hook en `showPage` para renderizar el panel del módulo |
| `index.html` | Botón "Recetas y Estándares" en sidebar y bottom-nav; página `page-estandarizacion` con 6 pestañas; datalist de operaciones; contenedor de impresión `#est-print`; carga de los 2 scripts nuevos |
| `style.css` | Estilos `est-*` (badges, stats, pasos, avisos) y hoja de impresión `@media print` |
| `sw.js` | Versión de caché v1.8→v1.9 y precache de los scripts nuevos |

No se modificó ninguna función existente de ventas, insumos, inventario,
catálogos, caja ni autenticación.

## 5. Migración

- IndexedDB `PanControl2` versión **3**. `onupgradeneeded` crea los stores que
  falten y no toca los existentes (`entradas`, `salidas_ins`, `produccion`,
  `salida_prod`, `catalogos`, `inventario` quedan intactos — verificado por
  prueba E2E).
- **Ejecución:** automática al abrir la app tras actualizar los archivos. No
  hay comandos que correr.
- **Reversión segura:** ver sección 12.

## 6. Modelo de datos (stores IndexedDB, keyPath `id` autoincremental)

- `est_ingredientes` — código, nombre, categoría, unidadBase (g/ml/und),
  `presentaciones:[{nombre,factorBase}]`, proveedor, costoRef, alérgenos,
  estado (activo/inactivo), obs, createdAt/updatedAt.
- `est_productos` — código, nombre, categoría, descripción, pesoAntes,
  pesoDespues, tolMin/tolMax, dimensiones, unidadVenta, vidaUtilDias,
  conservación, porBandeja, porLote, muestraRecomendada, estado
  (desarrollo/prueba/aprobado/suspendido/descontinuado).
- `est_recetas` — nombre, tipo (`producto`|`sub`), productoId, `organizacion`
  (empresa propietaria), `confidencialidad`
  (`interna`|`restringida`|`plantilla`|`transferible`; default `interna`),
  `transferidaDe:{organizacion,recetaId,fecha,por}` si es una copia recibida.
- `est_versiones` — recetaId, numero, estado, responsable, motivo,
  `salida:{cantidad,unidad}`, pesoUnidad, tiempoEsperadoMin, obs (conocimiento
  práctico), `componentes:[{tipo,refId,cantidad(base),porcentaje,orden,
  mermaPct,esBase,obligatorio,indicaciones,sustituto}]`,
  `pasos:[{n,nombre,descripcion,tiempoMin,tempC,velocidad,equipo,
  capacidadMax,visual,tactil,riesgos,puntoControl}]`, fechaAprobacion,
  aprobadoPor.
- `est_ordenes` — codigo, recetaId/versionId/versionNumero, productoId,
  **`snapshot`** (copia congelada de la versión), `plan` (unidades, factor,
  ingredientes teóricos, subrecetas, peso esperado, bandejas, tandas, tiempo),
  fecha, turno, responsable, equipo, estado, `real` (consumos, horas, pesos,
  buenas/defectuosas/quemadas/rotas/deformadas/muestra/reprocesadas,
  incidencias), `kpis`, `muestrasPeso:[g]`, `calidad`, loteId.
- `est_lotes` — codigo, fecha, ordenId, productoId, versionNumero,
  responsable, cantidadProducida/Aprobada/Rechazada, vencimiento (desde vida
  útil del producto), estado (pendiente/aprobado/aprobado_obs/retenido/
  rechazado), obs. Diseñado para relacionarse a futuro con lotes de insumos.
- `est_auditoria` — fecha, usuario (rol), acción, entidad, entidadId,
  antes/después, motivo.
- `est_organizaciones` — nombre, createdAt. Empresa propietaria de recetas y
  productos (ver Incremento 1a).
- `est_exportaciones` — fecha, usuario, recetaId, recetaNombre, versionId,
  versionNumero, `nivel` (confidencialidad al momento de la salida), `formato`
  (`json`|`csv`|`transferencia`), `destino` (`archivo`|`transferencia`),
  organizacionOrigen, organizacionDestino, autorizadoPor. Historial de cada
  salida de información (ver Incremento 1b).

Las cantidades calculables no se almacenan duplicadas, salvo los snapshots
históricos (plan y receta congelada en la orden), que existen a propósito.

## 7. Fórmulas implementadas (en `produccion-core.js`, con pruebas)

- Rendimiento % = unidades buenas reales / unidades esperadas × 100
- Merma % = peso perdido / peso total preparado × 100
  (peso perdido = peso teórico − peso obtenido − masa sobrante, mínimo 0)
- Peso utilizable = peso total preparado − pérdidas registradas
- Unidades esperadas = ⌊peso utilizable / peso estándar por unidad⌋
- Cumplimiento de peso % = muestras dentro del rango / total muestreado × 100
- Estadísticas de muestras: promedio, mín, máx, desviación estándar muestral,
  desvío vs objetivo, dentro/fuera de rango.
- **Redondeo:** ninguno durante el cálculo; al mostrar se usa `redondear(x,dp)`
  (2–3 decimales) y `fmtCantidad` (g→kg / ml→L a partir de 1000).

## 8. Pantallas agregadas (página "Recetas y Estándares")

1. **Panel** — órdenes pendientes/en proceso/terminadas, rendimiento y merma
   promedio, lotes retenidos/rechazados, mayor desviación, últimas recetas,
   auditoría reciente, herramientas (demo, respaldo, restauración).
2. **Ingredientes** — catálogo técnico con presentaciones configurables.
3. **Productos** — productos elaborados con pesos objetivo y tolerancias.
4. **Recetas** — recetas maestras, subrecetas, versiones, componentes con
   porcentaje panadero (base configurable, no atada a la harina), pasos con
   señales visuales/táctiles/riesgos, aprobación, exportación JSON/CSV.
5. **Calculadora** — Modalidad A (por unidades), B (por ingrediente
   disponible, ej. "tengo 15 kg de harina"), C (escalar por porcentaje);
   expansión recursiva de subrecetas con mermas; creación de orden en un clic.
6. **Órdenes y Lotes** — ciclo de vida completo, registro real validado,
   comparación plan vs real, control de peso por muestras, control de calidad
   por criterios, resolución de lote, vista imprimible (window.print, sin PDF).

## 9. Permisos implementados

| Acción | admin | tecnico* | maestro* | calidad* | viewer |
|---|---|---|---|---|---|
| Ver | ✔ | ✔ | ✔ | ✔ | ✔ |
| CRUD ingredientes/productos | ✔ | ✔ | — | — | — |
| Crear/editar recetas | ✔ | ✔ | — | — | — |
| Aprobar recetas | ✔ | ✔ | — | — | — |
| Crear órdenes / cambiar estado | ✔ | ✔ | ✔ | — | — |
| Registrar producción real | ✔ | — | ✔ | — | — |
| Evaluar calidad / resolver lotes | ✔ | ✔(eval) | — | ✔ | — |
| Demo / respaldo / config | ✔ | parcial | — | — | — |

\* Definidos en `EstCore.PERMISOS`; se activan agregando su hash de contraseña
en `ROLES` (app.js) y mapeándolos en `estRol()` (produccion-ui.js).

## 10. Pruebas y resultados

- **Dominio:** `node tests/produccion-core.test.js` → **58 pasadas, 0 falladas**.
  Cubren: conversiones g↔kg y presentaciones configurables, porcentajes
  panaderos, validación de versiones, inmutabilidad de recetas aprobadas,
  transiciones de estado, ciclos de subrecetas (directos e indirectos),
  calculadora A/B/C, mermas, fórmulas, estadísticas de peso, validación de
  cantidades negativas e inconsistencias, KPIs, snapshot histórico, matriz de
  permisos y accesos no autorizados, redondeo/formato.
- **E2E en Chromium (Playwright):** 28 pasadas, 0 falladas, 0 errores JS.
  Flujo completo: carga de la app sin romper páginas existentes → demo →
  CRUD ingredientes → receta aprobada en solo lectura → nueva versión →
  cálculo A (200 empanadas: 23 kg, 10 bandejas, 2 tandas, harina expandida
  7.918 kg) → cálculo B (15 kg de harina) → orden → programar → iniciar →
  rechazo de cierre incoherente → cierre válido con KPIs → lote → muestras de
  peso → evaluación de calidad → modo viewer bloqueado también por consola →
  migración IndexedDB verificada.
- El proyecto no tenía pruebas previas, por lo que no hay pruebas anteriores
  que mantener.

## 11. Cómo probar manualmente

1. Servir la carpeta (`python3 -m http.server` o el hosting actual) y abrir la
   app; iniciar sesión como administrador.
2. Entrar a **📐 Recetas y Estándares** → Panel → **"Cargar datos de
   demostración (ficticios)"** (marcados [DEMO]; no son fórmulas reales).
3. Recetas → abrir "Empanada de queso [DEMO]" v1 (aprobada, solo lectura) →
   "Crear nueva versión" para editar.
4. Calculadora → Empanada de queso [DEMO] → Modalidad A → 200 → Calcular →
   "Crear orden de producción".
5. Órdenes → abrir la orden → Programar → Iniciar → llenar el registro real
   (probar valores negativos o buenas > producidas para ver el rechazo) →
   Terminar → revisar KPIs, registrar pesos "118, 122, 130", evaluar el lote.
6. Cerrar sesión y entrar como viewer: todo queda en solo lectura.

## 12. Cómo revertir de forma segura

- **Código:** revertir el commit (o restaurar `app.js`, `index.html`,
  `style.css`, `sw.js` y borrar `produccion-core.js`, `produccion-ui.js`).
  Importante: **no** bajar `VER` de IndexedDB a 2 (abrir una BD con versión
  menor falla); basta dejar de usar los stores `est_*`: los datos existentes
  del resto de la app no se ven afectados en ningún caso.
- **Datos del módulo:** antes de revertir, descargar el respaldo JSON desde
  Panel → "Descargar respaldo del módulo". Ese archivo se puede restaurar
  después con "Restaurar respaldo del módulo".

## 13. Riesgos pendientes y limitaciones conocidas

1. **Sin backend:** los permisos y validaciones son de cliente; un usuario
   técnico con la consola del navegador puede saltarlos. Resolverlo requiere
   mover datos y reglas a un backend (p. ej. reglas de seguridad de Firestore
   + autenticación real), fuera del alcance de esta fase.
2. **Datos locales:** los stores `est_*` viven solo en el dispositivo hasta
   que se integren al sync. Mitigación: respaldo JSON del módulo.
3. **Float64:** sin enteros de precisión arbitraria; mitigado con unidades
   base y redondeo solo al mostrar. Para costos contables futuros conviene
   trabajar en céntimos.
4. **Fotos en recetas:** no implementadas; la app no tiene almacenamiento de
   archivos seguro (solo campos de texto para referencias visuales).

## 14. Preparado para fases futuras

- Integración con inventario/compras: los consumos reales de las órdenes ya
  quedan registrados por ingrediente y en unidades base.
- Costos: `costoRef` por unidad base ya existe en ingredientes.
- Lotes de insumos y trazabilidad completa: `est_lotes` tiene ordenId,
  productoId y versión; falta solo la relación con lotes de compra.
- Roles adicionales (tecnico/maestro/calidad): matriz lista, solo requieren
  credenciales.
- Sincronización en la nube de los stores `est_*`.
- Plantillas de calidad por producto (`EST_CRITERIOS_CALIDAD` hoy es una lista
  general fácilmente configurable).
- Exportación estructurada: ya disponible por receta (JSON/CSV) y por módulo
  (JSON); ampliable a fichas técnicas completas.

## 15. Incremento 1 — Propiedad y confidencialidad

### 1a — Separación por organización
Cada receta y producto pertenece a una **organización** (`est_organizaciones`).
La barra 🏢 permite elegir la organización activa; recetas y productos se
filtran por ella. Los registros creados antes de existir organizaciones caen en
la organización por defecto (la más antigua). Núcleo: `EstCore.perteneceAOrg`.

### 1b — Confidencialidad y control de exportación / transferencia
Cada receta tiene un **nivel de confidencialidad** (campo
`est_recetas.confidencialidad`, default `interna`) que decide si su contenido
puede salir del sistema. Núcleo puro en `produccion-core.js` (con pruebas):

| Nivel          | Exportar a archivo | Copiar a otra organización |
|----------------|--------------------|----------------------------|
| `interna`      | con autorización (queda registrada) | ❌ bloqueado |
| `restringida`  | ❌ bloqueado        | ❌ bloqueado |
| `plantilla`    | ✅ permitido        | ✅ permitido |
| `transferible` | ✅ permitido        | ✅ permitido |

- Funciones núcleo: `NIVELES_CONFIDENCIALIDAD`, `normNivelConfidencial`,
  `nivelConfidencial`, `politicaConfidencial`, `puedeExportarReceta`,
  `requiereAutorizacionExport`, `puedeTransferirReceta`.
- **Exportación** (`estExportarReceta`): bloquea las restringidas; en las
  internas pide el nombre de quien autoriza; toda salida se registra en
  `est_exportaciones` (**historial de exportaciones**, visible en la pestaña
  Recetas).
- **Transferencia** (`estTransferirReceta`): copia la receta y todas sus
  versiones a otra organización, solo si es `plantilla`/`transferible` y con
  autorización expresa. La copia queda como `interna` en el destino (evita
  reenvíos en cadena) y guarda `transferidaDe` para trazabilidad.
- El nivel se edita desde el editor de receta (solo admin). En la lista de
  recetas se muestra un distintivo de confidencialidad por receta.

> Nota: 1b refuerza la protección en la **interfaz** y deja el rastro en el
> historial. El **refuerzo en el servidor** (que el backend impida ver/editar o
> exportar datos de otra organización, no solo ocultarlos) corresponde al
> Incremento 1c, aún pendiente.
