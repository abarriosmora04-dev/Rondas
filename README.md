# Rondas

Aplicación web para verificar que el vigilante de un puesto (garita + aparcamiento) realiza
sus rondas periódicas y sigue activo, con alertas automáticas por email cuando algo falla.

**Arquitectura sin hosting propio:**
- El **backend es una Google Sheet** gestionada por un script de Google Apps Script
  (gratis, sin tarjeta, usa tu cuenta de Google).
- El **frontend es estático** (HTML/CSS/JS) y se sirve con **GitHub Pages** directamente
  desde este repositorio.
- Las **alertas se envían por email** con `MailApp` de Apps Script: no hace falta
  configurar ningún SMTP, usa tu propia cuenta de Google.

No necesitas crear ninguna cuenta nueva (ni Render, ni Railway, ni tarjetas de crédito):
solo tu Google y tu GitHub, que ya tienes.

## Cómo funciona

- El supervisor define **puntos de control** (checkpoints) físicos repartidos por el
  aparcamiento y la garita. Cada uno genera un código QR único para imprimir y pegar en su sitio.
- El vigilante **inicia turno** desde su móvil al llegar y lo **termina** al acabar.
- Con el turno abierto, cada vez que pasa por un punto escanea el QR con la **cámara nativa
  del móvil** (no hace falta abrir ninguna app: el QR lleva directamente a la web).
- El sistema exige completar **todos los puntos de control dentro de cada bloque horario**
  (por defecto, 3 rondas/hora = un bloque de 20 minutos). Si un bloque termina sin que se
  hayan escaneado todos los puntos, se genera una alerta.
- Además hay un **vigía de inactividad** (heartbeat): si pasan demasiados minutos sin ningún
  escaneo (por defecto 12), se envía una alerta de "posible ausencia o vigilante dormido",
  incluso antes de que termine el bloque de la ronda.
- Hay un **botón de pánico/SOS** en el panel del vigilante para emergencias reales.
- Todas las alertas (ronda incompleta, sin actividad, pánico) quedan registradas en la
  hoja de Google y se envían **por email**.

## Puesta en marcha (todo desde el navegador — Safari en iPad funciona bien)

El frontend ya está publicado por GitHub Actions en cuanto actives Pages (paso 2). Todo lo
de abajo se puede hacer desde Safari en el iPad, sin ordenador. Si el editor de Apps
Script se ve muy apretado, usa el menú "aA" de Safari → **"Solicitar sitio web de
escritorio"** para tener la barra de herramientas completa.

### 1. Backend: Google Sheet + Apps Script (un solo fichero para copiar)

1. Ve a [sheets.google.com](https://sheets.google.com) y crea una hoja de cálculo nueva
   ("+" → Hoja de cálculo en blanco). Ponle un nombre, por ejemplo "Rondas - datos".
2. Menú **Extensiones → Apps Script**. Se abre el editor de código, con un fichero
   `Code.gs` ya creado (vacío por defecto).
3. En este repositorio de GitHub, abre [`apps-script/Code.gs`](apps-script/Code.gs) y pulsa
   el botón **"Copy raw file"** (icono de portapapeles, arriba a la derecha del código) —
   copia todo el contenido de una vez, no hay que seleccionar nada a mano.
4. Vuelve a la pestaña de Apps Script, borra todo lo que haya en `Code.gs` (selecciona
   todo y pega encima) y pega el contenido copiado. Es el único fichero que hace falta:
   no crees ninguno más.
5. Guarda (icono de disquete arriba).
6. Arriba, junto al botón ▶ Ejecutar, hay un desplegable de funciones: elige
   **`initSheets`** y pulsa **▶ Ejecutar**. La primera vez te pedirá autorizar permisos
   (tu cuenta → "Avanzado" → "Ir a [nombre del proyecto] (no seguro)" — es tu propio
   script, es normal que Google avise así la primera vez). Esto crea las pestañas
   necesarias y dos usuarios de partida:
   - `supervisor` / `cambia-esta-clave`
   - `vigilante` / `cambia-esta-clave`

   **Cámbialas en cuanto entres** (panel de supervisor → Usuarios → crea las tuyas con tu
   contraseña y borra las de ejemplo).
7. En el mismo desplegable, elige **`setupTrigger`** y pulsa ▶ Ejecutar una vez. Esto crea
   el disparador que revisa las rondas cada minuto.
8. Botón **Implementar** (arriba a la derecha) → **Nueva implementación**:
   - Tipo: pulsa el engranaje y elige **Aplicación web**.
   - Ejecutar como: **Yo (tu cuenta)**.
   - Quién tiene acceso: **Cualquier usuario**.
   - Pulsa **Implementar** y autoriza de nuevo si te lo pide.
   - Copia la **URL de la aplicación web** que te da (algo como
     `https://script.google.com/macros/s/XXXXXXXX/exec`). La necesitarás en el siguiente
     paso.

**Importante para el futuro:** si algún día cambias el código y quieres volver a
desplegarlo, usa **Implementar → Gestionar implementaciones → editar (icono de lápiz) →
Nueva versión**, NO crees una implementación completamente nueva — si lo haces, la URL
cambia y tendrías que volver a pegarla en la app.

Las alertas por email llegan, por defecto, a la cuenta de Google dueña del script. Si
quieres cambiar el destinatario, abre la pestaña **Settings** de la Google Sheet y edita a
mano la fila `alertEmailTo`.

### 2. Frontend: GitHub Pages (un interruptor, una sola vez)

1. En este repositorio, en Safari: **Settings → Pages → Build and deployment → Source:
   "GitHub Actions"**. Es el único paso manual — GitHub no deja activarlo automáticamente
   la primera vez.
2. En cuanto esté activado, el workflow [`deploy-pages.yml`](.github/workflows/deploy-pages.yml)
   publica automáticamente la carpeta `public/` cada vez que se hace push a la rama
   `claude/guard-activity-verification-tz5qvk`. Si quieres forzar que se publique ya,
   entra en la pestaña **Actions** del repo y pulsa "Run workflow".
3. Cuando termine (un par de minutos), tu app estará en una URL del tipo:
   `https://<tu-usuario>.github.io/<nombre-del-repo>/`
4. Ábrela. La primera vez te pedirá la **URL de Apps Script** que copiaste en el paso
   anterior — pégala y pulsa "Probar conexión" para confirmar que responde, luego
   "Guardar".
5. Entra con `supervisor` / `cambia-esta-clave` (o las credenciales que hayas creado). En
   el iPad, desde Safari puedes usar "Compartir → Añadir a pantalla de inicio" para que se
   abra como una app aparte, sin barra de navegador.

## Primeros pasos ya dentro de la app

1. Como supervisor: crea los puntos de control (p.ej. "Entrada", "Zona A", "Zona B",
   "Garita") — cuantos más puntos alejados entre sí, más difícil es hacer las rondas sin
   moverse realmente.
2. Pulsa "Ver QR" en cada uno, imprímelo y pégalo físicamente en su sitio.
3. Ajusta en "Configuración de rondas" cuántas rondas por hora quieres exigir y a partir
   de cuántos minutos sin actividad quieres el aviso de "posible ausencia/sueño".
4. Da de alta al vigilante (o usa la cuenta semilla) y comparte con él la URL de GitHub
   Pages para que inicie sesión en su móvil (puede "Añadir a pantalla de inicio" para que
   se abra como una app).
5. El vigilante inicia turno, y a partir de ahí escanea los puntos con la cámara del móvil
   en cada ronda.

## Dónde viven los datos

Todo se guarda en la Google Sheet que creaste: pestañas `Users`, `Checkpoints`, `Scans`,
`Shifts`, `Alerts`, `RoundsHistory`, `Sessions` y `Settings`. Puedes abrirla directamente
para revisar el histórico, exportarlo a otra herramienta, o hacer una copia de seguridad
con **Archivo → Hacer una copia**.

## Notas de seguridad del enfoque

- Ningún sistema de rondas es 100% infalible (un QR se puede fotografiar y "escanear"
  desde la garita). Para reforzarlo: coloca los puntos en ubicaciones muy separadas entre
  sí, y revisa el histórico de horas de escaneo (rondas hechas siempre en segundos
  sospechosamente iguales son una señal de alerta).
- El aviso de inactividad (heartbeat) es la protección principal contra quedarse dormido
  en la garita, porque no depende de que complete la ronda entera: salta en cuanto pasa
  demasiado tiempo sin ningún registro.
- La autenticación es una implementación sencilla (hash SHA-256 + sal, tokens de sesión en
  la propia hoja) pensada para un puesto único de bajo riesgo, no para un sistema
  multiusuario expuesto públicamente a gran escala.

## Límites de Google Apps Script a tener en cuenta

- Cuenta de Gmail gratuita: unos 90 minutos de ejecución de script al día y unos 100
  emails/día — de sobra para el ritmo de comprobación de esta app (cada minuto). Si tienes
  Google Workspace, los límites son más altos.
- El primer request tras un rato inactivo puede tardar unos segundos en responder ("cold
  start" de Apps Script) — es normal, la app muestra un aviso de "Registrando..." mientras
  espera.
