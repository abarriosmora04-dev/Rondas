# Rondas

Aplicación web para verificar que el vigilante de un puesto (garita + aparcamiento) realiza
sus rondas periódicas y sigue activo, con alertas automáticas por email cuando algo falla.

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
- Todas las alertas (ronda incompleta, sin actividad, pánico) se registran en el panel del
  supervisor y se envían **por email** (el medio de notificación más barato: coste 0 con
  cualquier SMTP, incluido Gmail).

## Instalación

```bash
npm install
cp .env.example .env
```

Edita `.env`:

- `PUBLIC_URL`: la URL pública donde vayas a desplegar la app (se usa para generar los QR).
- `SEED_SUPERVISOR_USER` / `SEED_SUPERVISOR_PASS`: credenciales de la cuenta de supervisor
  que se crea automáticamente la primera vez que arranca (cámbialas).
- `SEED_GUARD_USER` / `SEED_GUARD_PASS`: credenciales de la primera cuenta de vigilante.
- `SMTP_*` y `ALERT_EMAIL_TO`: datos de tu cuenta de correo para enviar las alertas.
  - Con Gmail: activa la verificación en dos pasos y crea una "contraseña de aplicación"
    (myaccount.google.com/apppasswords). Es gratis y no tiene límite práctico para este uso.
  - También funciona con cualquier otro proveedor SMTP gratuito (Brevo, Zoho, etc.).
  - `ALERT_EMAIL_TO` es la dirección donde tú quieres recibir los avisos.

Arranca el servidor:

```bash
npm start
```

Por defecto escucha en `http://localhost:3000`.

## Desplegarlo para uso real

Para que el vigilante pueda escanear QR con la cámara del móvil necesitas la app accesible
por **HTTPS** desde internet (o al menos desde la red del aparcamiento). Opciones sencillas
y gratuitas/baratas: Render, Railway, Fly.io, un VPS pequeño, o incluso un Raspberry Pi con
un túnel (Cloudflare Tunnel, ngrok) si prefieres tenerlo todo en el propio local.

Los datos se guardan en `data/db.json`. Si despliegas en una plataforma con almacenamiento
efímero, asegúrate de montar un volumen persistente en la carpeta `data/`, o los datos
(usuarios, histórico, checkpoints) se perderán al reiniciar.

## Primeros pasos tras desplegar

1. Entra como supervisor (`SEED_SUPERVISOR_USER`) en `/supervisor.html`.
2. Crea los puntos de control (p.ej. "Entrada", "Zona A", "Zona B", "Garita") — cuantos más
   puntos alejados entre sí, más difícil es hacer las rondas sin moverse realmente.
3. Descarga el QR de cada uno (botón "Ver QR"), imprímelo y pégalo físicamente en su sitio.
4. Ajusta en "Configuración de rondas" cuántas rondas por hora quieres exigir y a partir de
   cuántos minutos sin actividad quieres el aviso de "posible ausencia/sueño".
5. Da de alta al vigilante (o usa la cuenta semilla) y comparte con él la URL de
   `/index.html` para que inicie sesión en su móvil.
6. El vigilante inicia turno, y a partir de ahí escanea los puntos con la cámara del móvil
   en cada ronda.

## Notas de seguridad del enfoque

- Ningún sistema de rondas es 100% infalible (un QR se puede fotografiar y "escanear" desde
  la garita). Para reforzarlo: coloca los puntos en ubicaciones muy separadas entre sí,
  cambia el QR/código periódicamente, y revisa el histórico de horas de escaneo (rondas
  hechas siempre en segundos sospechosamente iguales son una señal de alerta).
- El aviso de inactividad (heartbeat) es la protección principal contra quedarse dormido en
  la garita, porque no depende de que complete la ronda entera: salta en cuanto pasa
  demasiado tiempo sin ningún registro.
