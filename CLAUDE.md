# PanControl — Guía para agentes (LÉEME ANTES DE HACER CAMBIOS)

Esta app **cambió de arquitectura dos veces**:

1. Firebase + IndexedDB en el navegador → **obsoleta**.
2. Servidor propio Node + Express + SQLite (`server/`) en un VPS de Vultr →
   **en retiro**: se mantiene solo hasta terminar la migración y apagar el VPS.
3. **Actual: Cloudflare Workers + D1 (plan gratis).** La API vive en
   `worker/index.js`, los datos en la base D1 `pancontrol` y el frontend en
   `public/`. Lo usa una sola persona desde PC, tablet y celular.

Lee esto completo antes de tocar nada.

## Rama de trabajo

- **`main` es la rama OFICIAL.** Cloudflare despliega sola cada cambio que
  llega a `main` (Workers Builds conectado al repo).
- Parte siempre de `main`: `git fetch origin && git checkout main && git pull`.
  Crea tu rama desde `main` y fusiónala de vuelta a `main` (PR).
- Si ves `firebase`, `indexedDB` o archivos del frontend fuera de `public/`,
  estás en una versión vieja.

## Estructura del proyecto

```
wrangler.toml      → configuración de Cloudflare: assets (public/) + Worker + D1
worker/index.js    → API (/api/...): login, CRUD de stores, organizaciones,
                     fotos, importación. Lista de STORES permitidos.
public/            → TODO el frontend (esto es lo que ve el navegador)
  index.html, style.css, app.js, sw.js, manifest.json, logo.png, *.mp4
  produccion-core.js / produccion-ui.js → módulo Producción y Estandarización
tests/             → pruebas: `npm test` (o node tests/<archivo>.test.js)
  worker-api.test.js      → API del Worker en local (wrangler dev + D1 temporal)
  migracion.test.js       → migración VPS → Cloudflare de punta a punta
  lib/org-scope-scenario.js → escenario común: Worker y Express deben dar lo mismo
server/            → servidor viejo del VPS (EN RETIRO, no agregar funciones)
  migrar-a-cloudflare.js → copia la base + fotos del VPS a Cloudflare
backend-cloudflare-worker/ → Worker aparte del OCR de facturas (no cambia)
excel/             → versión Excel con macros (prueba). Ver excel/LEEME.md
```

## Cómo se guardan y leen datos (regla de oro)

- En el frontend usa **`dbAll(store)`, `dbAdd(store,obj)`, `dbPut(store,obj)`,
  `dbDel(store,id)`** (definidas en `public/app.js`). Son `async` y hablan con
  la API (`/api/store/<store>`). **NO uses IndexedDB, localStorage ni Firebase
  para datos del negocio.**
- Cada registro es un objeto JSON con un `id` numérico que asigna el servidor.
- **Para agregar un tipo de dato nuevo (store):** añádelo al array `STORES` en
  `worker/index.js`. La tabla se crea sola. Si no lo agregas, la API responde
  404. Mientras el VPS siga vivo, agrégalo también en `server/db.js`.

## Límites del plan gratis de Cloudflare (tenlos en cuenta)

- **10 ms de CPU por petición**: nada de cálculos pesados en el Worker; evita
  parsear JSON de tablas enteras si no hace falta (ver `filasAJson`).
- **50 consultas a D1 por petición**: para muchas filas usa inserciones
  múltiples (`insertarVarios`), no un INSERT por fila.
- **5 M filas leídas por día**: los GET usan ETag con un contador global de
  versión (`meta.version`). **Toda escritura debe subir la versión**
  (`subirVersion`) o la app mostrará datos viejos.
- **2 MB por fila**: las fotos se guardan en base64 con tope de 1.4 MB.
- El Worker no guarda memoria entre peticiones: estado → D1.

## Roles y seguridad

- Login solo con contraseña. Las contraseñas son **secretos del Worker**
  (`ADMIN_PASSWORD` obligatorio, `VIEWER_PASSWORD` opcional) configurados en el
  panel de Cloudflare; nunca en el código. La sesión es una cookie httpOnly
  firmada (HMAC). El rol vive en `currentRole` (`'admin'` o `'viewer'`).
- **Las escrituras (POST/PUT/DELETE) las bloquea el Worker** para `viewer`
  (403). No confíes solo en ocultar botones con CSS.
- Para ocultar acciones de escritura en la UI usa la clase `est-admin-only` o
  `body.viewer-mode`.

## Cómo agregar una función/módulo nuevo (patrón)

1. Crea tu JS en `public/` (ej. `public/mi-modulo.js`).
2. Referéncialo en `public/index.html` con `<script src="mi-modulo.js"></script>`
   DESPUÉS de `app.js`.
3. Agrégalo a `PRECACHE_URLS` y **sube la versión** de `CACHE_NAME` en
   `public/sw.js` (si no subes la versión, los usuarios no ven el cambio).
4. Si guardas datos nuevos, agrega el/los store(s) a `STORES` en `worker/index.js`.
5. Si agregas una ruta nueva a la API, hazlo en `worker/index.js` (función
   `manejarApi`) y agrega su prueba en `tests/worker-api.test.js`.
6. Usa `dbAll/dbAdd/dbPut/dbDel`, `escHtml`, `toast` (ya existen en `app.js`).

## Probar antes de desplegar (obligatorio)

```bash
npm install
npm test                                     # todas las pruebas (incluye el Worker en local)
echo 'ADMIN_PASSWORD=admin123' > .dev.vars   # contraseña local (no se sube a git)
npx wrangler dev                             # app completa en http://localhost:8787
```

## Desplegar

No hay comandos para el dueño: **fusiona tu rama a `main`** y Cloudflare
publica sola en 1–2 minutos. Avísale al dueño qué cambió.

La puesta en marcha inicial en Cloudflare, la migración de datos desde Vultr y
el apagado del VPS están en `README-DEPLOY.md` (escrito para el dueño, no
técnico).

## Versión Excel (`excel/`)

Hay una versión de prueba en Excel (`excel/PanControl.xlsm`) que el dueño está
evaluando como alternativa. **El `.xlsm` se genera**: cambia
`excel/construir_excel.py` o `excel/vba/*.bas`, regenera con
`python3 excel/construir_excel.py` y prueba con
`python3 excel/verificar_vba.py` y `/usr/bin/python3 excel/probar_excel.py`
(LibreOffice). Lee los cuidados de VBA en `excel/LEEME.md`.

## Qué NO hacer

- ❌ No reintroducir Firebase, IndexedDB, ni `_localId`/sincronización dual.
- ❌ No agregar funciones a `server/` (está en retiro); todo va en `worker/`.
- ❌ No poner archivos del frontend en la raíz — van en `public/`.
- ❌ No exponer contraseñas ni claves en el código (usa secretos del Worker).
- ❌ No cambies `database_name = "pancontrol"` ni el `binding = "DB"` en
  `wrangler.toml`: Cloudflare vincula la base por ese nombre (no hace falta
  `database_id`). Cambiarlos crearía una base NUEVA y vacía.
