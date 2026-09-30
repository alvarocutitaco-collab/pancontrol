# Pasar PanControl de Vultr a Cloudflare (gratis)

PanControl ahora puede correr **gratis en Cloudflare**: la misma app, las
mismas pantallas, con los datos en la nube. Se usa desde la PC, la tablet y el
celular con los mismos datos. Cuando todo esté comprobado, puedes dar de baja
el servidor de Vultr y dejar de pagarlo.

Son 4 partes. Las haces una sola vez.

---

## Parte 1 — Publicar la app en Cloudflare (10 minutos)

1. Entra a **https://dash.cloudflare.com** con la misma cuenta donde ya tienes
   el lector de facturas (`pancontrol-ocr-ia`).
2. En el menú de la izquierda entra a **Workers & Pages** y pulsa
   **Create** (Crear).
3. Elige **Import a repository** (Importar un repositorio). Si te pide
   conectar GitHub, acepta y dale acceso al repositorio `pancontrol`.
4. Elige el repositorio **alvarocutitaco-collab/pancontrol**. Deja el nombre
   del proyecto como `pancontrol` y todo lo demás como viene. Pulsa
   **Deploy** (Desplegar).
5. Espera 1 a 3 minutos. Cloudflare crea sola la base de datos y te muestra la
   dirección de tu app, algo como:
   `https://pancontrol.alvarocutitaco.workers.dev` → **anótala**.

### Poner la contraseña

6. Dentro del proyecto `pancontrol` entra a **Settings** (Configuración) →
   **Variables and Secrets** (Variables y secretos) → **Add** (Agregar).
7. Tipo: **Secret**. Nombre: `ADMIN_PASSWORD`. Valor: la contraseña que
   quieras para entrar como administrador. Guarda (**Deploy**).
8. *(Opcional)* Si quieres una contraseña de **solo lectura** para alguien que
   solo mire, agrega otro secreto llamado `VIEWER_PASSWORD`.
9. Abre la dirección de tu app y entra con tu contraseña para comprobar que
   funciona. **Todavía no cargues datos**: primero pasa los de Vultr (Parte 2).

> Para cambiar la contraseña más adelante, edita el secreto en ese mismo
> lugar. Al cambiarla, se cierran las sesiones abiertas en todos los equipos.

---

## Parte 2 — Pasar tus datos de Vultr a Cloudflare (5 minutos)

Entra por SSH a tu servidor de Vultr, como siempre, y copia estas líneas
(cambia la dirección por la tuya del paso 5):

```bash
cd /root/pancontrol
git pull origin main
node server/migrar-a-cloudflare.js https://pancontrol.alvarocutitaco.workers.dev
```

Te pedirá la contraseña de administrador **de la app nueva** (la del paso 7).
Después copia todos los registros y las fotos y al final muestra una
verificación como esta:

```
🔎 Verificación (este servidor → app nueva):
   ✓ entradas: 1234 → 1234
   ✓ produccion: 856 → 856
   ...
✅ Listo. Todos los datos están en la app nueva.
```

- Esto **no borra ni cambia nada** en Vultr: solo lee.
- Si se corta a la mitad, vuelve a correr la última línea agregando
  ` --forzar` al final. No duplica nada.
- Desde este momento **usa solo la app nueva**. Lo que registres en la vieja
  ya no pasa a la nueva.

---

## Parte 3 — Usar la app nueva

1. Abre la dirección nueva en la **PC, la tablet y el celular** y entra con tu
   contraseña.
2. Revisa que estén tus entradas, producción, inventario, recetas y fotos.
3. En la tablet y el celular puedes instalarla como app: en el menú del
   navegador elige **"Agregar a pantalla de inicio"** o **"Instalar app"**.

**Actualizaciones:** ya no tienes que hacer nada. Cada vez que se aprueba un
cambio en GitHub (rama `main`), Cloudflare publica la nueva versión solo en
1 o 2 minutos.

**Respaldos:** Cloudflare guarda automáticamente la historia de la base de
datos de los **últimos 7 días**. Si algo se borra por error, se puede volver
atrás a cualquier momento de esa semana (pídele ayuda a Claude). Además puedes
seguir usando el botón **"💾 Descargar backup"** de la app cuando quieras
guardar una copia en tu equipo.

---

## Parte 4 — Dar de baja Vultr (cuando todo esté bien)

Recomendado: usa la app nueva **una o dos semanas** antes de este paso.

1. **Guarda una copia final** de los datos de Vultr en tu PC. En el servidor:

   ```bash
   cd /root/pancontrol
   tar czf /root/respaldo-pancontrol.tar.gz data
   ```

   Y en tu PC (PowerShell en Windows), cambiando `IP-DEL-SERVIDOR`:

   ```bash
   scp root@IP-DEL-SERVIDOR:/root/respaldo-pancontrol.tar.gz .
   ```

2. **Comprueba que el servidor no aloja nada más** (por ejemplo, la web de Casa
   Milagro). En el servidor:

   ```bash
   pm2 list
   ls /etc/nginx/sites-enabled/
   ```

   Si solo aparece `pancontrol`, puedes borrarlo. Si aparece algo más, **no lo
   borres**: eso también se caería.
3. En **https://my.vultr.com** → **Products** → tu servidor → **Destroy**
   (Destruir). Ojo: un servidor solo "apagado" **se sigue cobrando**. Hay que
   destruirlo para dejar de pagar.

### ¿Y la dirección pancontrol.casamilagro.com.pe?

Después de destruir el servidor, esa dirección deja de funcionar. Puedes usar
la dirección `...workers.dev` de Cloudflare, o conectar tu dominio a la app
nueva: en el proyecto `pancontrol` → **Settings** → **Domains & Routes** →
**Add** → **Custom domain** → `pancontrol.casamilagro.com.pe`. Esto funciona si
el dominio `casamilagro.com.pe` está administrado en Cloudflare. Si está en
otro lugar, pide ayuda para moverlo.

---

## Detalles técnicos (para quien mantenga la app)

- `wrangler.toml` define todo: la app web (`public/`), la API
  (`worker/index.js`) y la base D1 `pancontrol` (se crea sola en el primer
  despliegue: no lleva `database_id`).
- Secretos del Worker: `ADMIN_PASSWORD` (obligatorio) y `VIEWER_PASSWORD`
  (opcional). La clave para firmar las sesiones se genera sola y se guarda en
  la base.
- Límites del plan gratis: 100 000 peticiones/día, 5 GB de base de datos,
  10 ms de CPU por petición y 50 consultas por petición. Para una persona sobra.
- Probar en local: crea `.dev.vars` con `ADMIN_PASSWORD=admin123` y corre
  `npx wrangler dev`. Pruebas: `npm test`.
- El lector de facturas (`backend-cloudflare-worker/`) es otro Worker aparte y
  no cambia.
