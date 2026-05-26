# Backend OCR + IA para PanControl

Este backend crea el endpoint que tu app necesita:

```text
POST /api/ocr-factura
```

Esta version esta pensada para desplegarse como **Cloudflare Worker**. Recibe la foto de la factura/boleta, la envia a OpenAI con salida estructurada JSON y devuelve los datos listos para que PanControl llene el formulario editable.

## Pasos

1. Crea una cuenta o entra a Cloudflare.
2. Instala Wrangler en tu PC si quieres desplegar desde terminal:

```bash
npm install -g wrangler
```

3. Entra a esta carpeta:

```bash
cd backend-cloudflare-worker
```

4. Inicia sesion:

```bash
wrangler login
```

5. Guarda tu clave de OpenAI como secreto:

```bash
wrangler secret put OPENAI_API_KEY
```

6. Despliega:

```bash
wrangler deploy
```

7. Cloudflare te dara una URL parecida a:

```text
https://pancontrol-ocr-ia.tuusuario.workers.dev
```

En la app PanControl, en el campo **URL servicio OCR + IA**, coloca:

```text
https://pancontrol-ocr-ia.tuusuario.workers.dev
```

Luego sube o toma una foto y toca **Analizar documento**.

## Notas

- La clave de OpenAI nunca debe ir en `index.html`.
- Por ahora este Worker acepta imagenes (`jpg`, `png`, `webp`). Si necesitas PDF, conviene convertir el PDF a imagen antes de enviarlo o agregar conversion en otro backend.
- La app no registra automaticamente: primero precarga el formulario y deja editar antes de guardar.
