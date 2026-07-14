# PanControl — Guía para agentes (LÉEME ANTES DE HACER CAMBIOS)

Esta app **cambió de arquitectura**. Antes usaba Firebase + IndexedDB en el
navegador. **Ahora es una app cliente–servidor propia** (Node + Express +
SQLite) que corre en el VPS del dueño. Si trabajas sobre la versión vieja,
romperás el despliegue. Lee esto completo.

## Rama de trabajo (IMPORTANTE — LÉELO)

⚠️ **Hay DOS versiones vivas en paralelo hasta que se complete la migración:**

- **`main` = versión ANTIGUA (Firebase/IndexedDB, archivos en la raíz).** Es la
  que **Netlify** sirve a la operadora (Mari) en producción **hoy**. **NO la
  toques.** Modificar `main` cambia la app que Mari usa a diario.
- **`claude/app-robustness-review-tmufc5` = versión NUEVA y oficial de desarrollo**
  (Node + Express + SQLite, frontend en `public/`, con todos los módulos). Es la
  que corre en el VPS propio (`pancontrol.casamilagro.com.pe`).

**Trabaja SIEMPRE sobre `claude/app-robustness-review-tmufc5`:**
`git fetch origin && git checkout claude/app-robustness-review-tmufc5 && git pull`.

Cuando se haga la migración final (mover a Mari al VPS y apagar Netlify), esta
rama pasará a ser `main`. Hasta entonces, **no fusiones nada a `main`.**

## Estructura del proyecto

```
server/            → backend (NO tocar salvo para agregar rutas/stores)
  index.js         → app Express, sirve public/ y monta /api
  db.js            → SQLite + lista de STORES permitidos
  auth.js          → sesiones + login; requireAuth / requireAdmin
  routes/          → auth.js (login/logout/session) y store.js (CRUD genérico)
  seed-users.js    → crear/cambiar contraseñas: node server/seed-users.js admin "clave"
  migrate-backup.js→ importar un backup JSON de la app vieja
public/            → TODO el frontend (esto es lo que ve el navegador)
  index.html, style.css, app.js, sw.js, manifest.json, logo.png, *.mp4
  produccion-core.js / produccion-ui.js → módulo Producción y Estandarización
tests/             → node tests/<archivo>.test.js  (sin dependencias)
```

## Cómo se guardan y leen datos (regla de oro)

- En el frontend usa **`dbAll(store)`, `dbAdd(store,obj)`, `dbPut(store,obj)`,
  `dbDel(store,id)`** (definidas en `public/app.js`). Son `async` y hablan con
  la API del servidor (`/api/store/<store>`). **NO uses IndexedDB ni Firebase.**
- Cada registro es un objeto JSON con un `id` numérico que asigna el servidor.
- **Para agregar un tipo de dato nuevo (store):** añádelo al array `STORES` en
  `server/db.js`. El servidor crea la tabla sola al arrancar. Si no lo agregas,
  la API responde 404 y no podrás guardar.

## Roles y seguridad

- Login por contraseña → sesión de servidor (cookie httpOnly). El rol vive en
  `currentRole` (`'admin'` o `'viewer'`) en el frontend.
- **Las escrituras (POST/PUT/DELETE) las bloquea el servidor** para `viewer`
  (middleware `requireAdmin` → 403). No confíes solo en ocultar botones con CSS;
  la seguridad real está en el servidor.
- Para ocultar acciones de escritura en la UI usa la clase `est-admin-only` o
  `body.viewer-mode`.

## Cómo agregar una función/módulo nuevo (patrón)

1. Crea tu JS en `public/` (ej. `public/mi-modulo.js`).
2. Referéncialo en `public/index.html` con `<script src="mi-modulo.js"></script>`
   DESPUÉS de `app.js`.
3. Agrégalo a `PRECACHE_URLS` y **sube la versión** de `CACHE_NAME` en
   `public/sw.js` (si no subes la versión, los usuarios no ven el cambio).
4. Si guardas datos nuevos, agrega el/los store(s) a `STORES` en `server/db.js`.
5. Usa `dbAll/dbAdd/dbPut/dbDel`, `escHtml`, `toast` (ya existen en `app.js`).

## Probar antes de desplegar (obligatorio)

```bash
npm install
node tests/produccion-core.test.js        # o los tests que apliquen
rm -f data/pancontrol.db*                   # base limpia de prueba
node server/seed-users.js admin "admin123"
PORT=3998 node server/index.js &            # levantar
# probar en el navegador o con curl que login + guardar + leer funcionen
```

## Desplegar al servidor del dueño

El dueño (no técnico) despliega copiando estos comandos en su terminal SSH:

```bash
cd /root/pancontrol
git pull origin claude/app-robustness-review-tmufc5
pm2 restart pancontrol
```

Deja tus cambios **commiteados y pusheados** a la rama de trabajo, y entrégale
al dueño ese bloque de 3 líneas. No necesita nada más.

## Qué NO hacer

- ❌ No reintroducir Firebase, IndexedDB, ni `_localId`/sincronización dual.
- ❌ No poner archivos del frontend en la raíz — van en `public/`.
- ❌ No exponer contraseñas ni claves en el código del cliente.
- ❌ No basarte en `main`.
