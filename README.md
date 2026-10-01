# PanControl (DonPancho)

ERP simple de producción para panadería: insumos, producción, salidas,
inventario, catálogos y el módulo de Producción y Estandarización (recetas,
versiones, calculadora, órdenes, lotes, calidad y operadores).

## Arquitectura

- **Cloudflare Workers + D1** (plan gratis). `wrangler.toml` publica:
  - la app web (`public/`): HTML/CSS/JS sin build (vanilla JS), habla con la
    API por `fetch`;
  - la API (`worker/index.js`): login, CRUD de datos, organizaciones y fotos
    en `/api/...`;
  - la base de datos D1 `pancontrol` (SQLite), la única fuente de verdad.
- **OCR de facturas** (`backend-cloudflare-worker/`): otro Worker aparte que
  lee fotos de facturas con IA. Se configura por separado (ver su README).
- **`excel/`**: versión de prueba en Excel con macros (`PanControl.xlsm`), generada
  por `excel/construir_excel.py`. Ver [`excel/LEEME.md`](./excel/LEEME.md).
- **`server/`** (Node + Express + SQLite): el servidor anterior del VPS de
  Vultr. Se mantiene solo hasta terminar la migración
  (`server/migrar-a-cloudflare.js`) y apagar el VPS.

## Correr en local

```bash
npm install
echo 'ADMIN_PASSWORD=admin123' > .dev.vars
npm run dev
```

Abre `http://localhost:8787`.

## Pruebas

```bash
npm test
```

## Desplegar en producción

Cloudflare despliega solo cada cambio que llega a la rama `main`. La
configuración inicial y la migración desde Vultr están paso a paso en
[`README-DEPLOY.md`](./README-DEPLOY.md).
