# Desplegar PanControl en tu VPS de Vultr (Ubuntu)

Esta guía asume el mismo patrón que ya usas para Casa Milagro: un VPS Ubuntu,
Node.js corriendo con PM2, y Nginx como puerta de entrada con HTTPS.

## 1. Preparar el servidor (una sola vez)

```bash
# Conéctate por SSH a tu VPS
ssh usuario@tu-servidor

# Instalar Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar PM2 (mantiene la app corriendo y la reinicia si se cae)
sudo npm install -g pm2
```

## 2. Subir el código

```bash
git clone <URL-de-este-repositorio> pancontrol
cd pancontrol
npm install --production
```

## 3. Configurar variables de entorno

Crea un archivo `.env` (o exporta las variables en el sistema) con:

```bash
SESSION_SECRET=una-frase-larga-y-secreta-que-solo-tu-conoces
NODE_ENV=production
TRUST_PROXY=1
```

`SESSION_SECRET` protege las sesiones de los usuarios — cámbialo por algo
único (no uses el valor de ejemplo).

## 4. Crear las cuentas de acceso

```bash
node server/seed-users.js admin "TU-CLAVE-DE-ADMIN"
node server/seed-users.js viewer "TU-CLAVE-DE-SOLO-LECTURA"
```

Puedes correr este comando de nuevo en cualquier momento para cambiar una
contraseña.

## 5. Migrar los datos de la app anterior (Firebase)

1. Abre la versión anterior de PanControl (la que usa Firebase) y descarga el
   backup con el botón **"💾 Descargar backup"** en el Dashboard.
2. Copia ese archivo `.json` a tu VPS.
3. Corre:

```bash
node server/migrate-backup.js ruta/al/backup.json
```

4. Abre la nueva app y confirma que los datos coinciden antes de dejar de usar
   la versión anterior.

## 6. Arrancar la app con PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # sigue las instrucciones que imprime, para que arranque solo si el VPS se reinicia
```

La app queda escuchando en `http://localhost:3000` dentro del servidor.

## 7. Nginx como puerta de entrada (con HTTPS)

```nginx
server {
    listen 80;
    server_name pancontrol.tudominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Guarda esto en `/etc/nginx/sites-available/pancontrol`, actívalo y pide
certificado HTTPS gratis:

```bash
sudo ln -s /etc/nginx/sites-available/pancontrol /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pancontrol.tudominio.com
```

## 8. Respaldos

Todos los datos viven en un solo archivo: `data/pancontrol.db`. Para
respaldarlo basta con copiarlo:

```bash
cp data/pancontrol.db respaldo-$(date +%F).db
```

Puedes automatizarlo con una tarea programada (`cron`) que copie ese archivo
todos los días a otro lugar (otro disco, un bucket, etc.).

## Actualizar la app después de un cambio de código

```bash
cd pancontrol
git pull
npm install --production
pm2 restart pancontrol
```

## El backend de OCR (facturas) no cambia

El servicio que lee fotos de facturas (`backend-cloudflare-worker/`) sigue
desplegado en Cloudflare, tal como estaba. No necesita moverse al VPS.
