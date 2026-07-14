# PanControl (DonPancho)

ERP simple de producción para panadería: insumos, producción, salidas,
inventario y catálogos. Un operador registra los movimientos del día; el
resto del equipo solo consulta.

## Arquitectura

- **Backend propio** (`server/`): Node.js + Express + SQLite. Sirve la API
  (`/api/...`) y los archivos estáticos de `public/`. Es la única fuente de
  verdad — no hay sincronización con servicios externos para los datos del
  negocio.
- **Frontend** (`public/`): HTML/CSS/JS sin build (vanilla JS), habla con el
  backend por `fetch`.
- **OCR de facturas** (`backend-cloudflare-worker/`): servicio aparte en
  Cloudflare Workers que lee fotos de facturas con IA. Se configura por
  separado (ver su propio README).

## Correr en local

```bash
npm install
node server/seed-users.js admin "tu-clave"
node server/seed-users.js viewer "otra-clave"
npm start
```

Abre `http://localhost:3000`.

## Desplegar en producción

Ver [`README-DEPLOY.md`](./README-DEPLOY.md) para la guía paso a paso en un
VPS (Ubuntu + PM2 + Nginx).
